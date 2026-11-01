"""Validate the complete dependency archive before extracting any member."""

import json
import posixpath
import sys
import tarfile
from pathlib import PurePosixPath


def validate(archive, policy):
    roots = policy["roots"]
    links = policy["workspaceLinks"]

    def inside_installation(name):
        return any(name == root or name.startswith(root + "/") for root in roots)

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
        if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
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
    for name in seen:
        for parent in PurePosixPath(name).parents:
            ancestor = seen.get(str(parent))
            if ancestor and not ancestor.isdir():
                raise ValueError(f"Archive member traverses a link or file: {name}")
    for root in roots:
        if root not in seen or not seen[root].isdir():
            raise ValueError(f"Missing archive installation root: {root}")
    return members


def main():
    mode, path, *destination = sys.argv[1:]
    policy = json.load(sys.stdin)
    with tarfile.open(path, "r:") as archive:
        members = validate(archive, policy)
        if mode == "extract":
            archive.extractall(destination[0], members=members, filter="data")
        elif mode != "validate":
            raise ValueError("Unknown archive operation")


if __name__ == "__main__":
    main()
