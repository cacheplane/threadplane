"""Validate the complete dependency archive before extracting any member."""

import json
import posixpath
import sys
import tarfile
from collections import deque
from pathlib import PurePosixPath


def validate(archive, policy):
    roots = policy["roots"]
    links = policy["workspaceLinks"]
    root_names = set(roots)
    root_prefixes = tuple(root + "/" for root in roots)

    def inside_installation(name):
        return name in root_names or name.startswith(root_prefixes)

    def relative(name):
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or "\\" in name:
            raise ValueError(f"Invalid archive path: {name}")
        return str(path)

    members = archive.getmembers()
    seen = {}
    for member in members:
        name = relative(member.name)
        if not inside_installation(name):
            raise ValueError(f"Unexpected archive root: {name}")
        if name in seen:
            raise ValueError(f"Duplicate archive member: {name}")
        if member.type not in (
            tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE, tarfile.SYMTYPE, tarfile.LNKTYPE
        ) or member.sparse is not None:
            raise ValueError(f"Special archive member: {name}")
        if member.issym():
            if posixpath.isabs(member.linkname) or "\\" in member.linkname:
                raise ValueError(f"Absolute archive link: {name}")
            target = posixpath.normpath(posixpath.join(posixpath.dirname(name), member.linkname))
            if target.startswith("../") or (not inside_installation(target) and links.get(name) != target):
                raise ValueError(f"Escaping archive symlink: {name}")
        if member.islnk():
            target = relative(member.linkname)
            if not inside_installation(target) or target not in seen or not seen[target].isfile():
                raise ValueError(f"Invalid archive hardlink: {name}")
        seen[name] = member
    # Never traverse a link while extracting another entry, even when its
    # destination would otherwise be a permitted workspace or package path.
    checked_ancestors = set()
    for name in seen:
        chain = []
        parent = posixpath.dirname(name) or "."
        while parent not in checked_ancestors:
            ancestor = seen.get(parent)
            if ancestor and not ancestor.isdir():
                raise ValueError(f"Archive member traverses a link or file: {name}")
            chain.append(parent)
            if parent == ".":
                break
            parent = posixpath.dirname(parent) or "."
        # Only reuse a chain after every ancestor in the complete graph passed.
        checked_ancestors.update(chain)
    # Resolve against the complete archive graph, regardless of entry order.
    # Normalizing '..' before following workspace links can hide an escape.
    for name, member in seen.items():
        if not member.issym():
            continue
        pending = deque(PurePosixPath(posixpath.join(posixpath.dirname(name), member.linkname)).parts)
        resolved = []
        followed = 0
        while pending:
            part = pending.popleft()
            if part == "..":
                if not resolved:
                    raise ValueError(f"Escaping archive link graph: {name}")
                resolved.pop()
                continue
            resolved.append(part)
            ancestor = seen.get("/".join(resolved))
            if ancestor and ancestor.issym():
                followed += 1
                if followed > 40:
                    raise ValueError(f"Cyclic archive link graph: {name}")
                resolved.pop()
                pending.extendleft(reversed(PurePosixPath(ancestor.linkname).parts))
            elif ancestor and pending and not ancestor.isdir():
                raise ValueError(f"Archive link traverses a file: {name}")
        target = "/".join(resolved)
        if not inside_installation(target) and links.get(name) != target:
            raise ValueError(f"Escaping archive resolved link: {name}")
    for root in roots:
        if root not in seen or not seen[root].isdir():
            raise ValueError(f"Missing archive installation root: {root}")
    return members


def prevalidated_data_filter(member, destination):
    # Links retain the standard filter's resolved-target checks and normalization:
    # lexical containment alone is insufficient when another link is traversed.
    if member.issym() or member.islnk():
        return tarfile.data_filter(member, destination)
    # validate() has checked every physical path and all its ancestors before
    # extraction into fresh private staging. Repeating realpath for each file
    # adds filesystem work without changing that graph. Preserve data_filter's
    # permission and ownership policy for these already validated entries.
    mode = member.mode & 0o755
    if member.isreg():
        if not mode & 0o100:
            mode &= ~0o111
        mode |= 0o600
    else:
        mode = None
    return member.replace(mode=mode, uid=None, gid=None, uname=None, gname=None, deep=False)


def main():
    mode, path, *destination = sys.argv[1:]
    policy = json.load(sys.stdin)
    with tarfile.open(path, "r:") as archive:
        members = validate(archive, policy)
        if mode == "extract":
            archive.extractall(destination[0], members=members, filter=prevalidated_data_filter)
        elif mode != "validate":
            raise ValueError("Unknown archive operation")


if __name__ == "__main__":
    main()
