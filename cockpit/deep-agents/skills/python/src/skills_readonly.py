"""Read-only StoreBackend mount for bundled Skills on the shared deployment."""

from deepagents.backends import StoreBackend
from deepagents.backends.protocol import (
    PERMISSION_DENIED,
    DeleteResult,
    EditResult,
    FileUploadResponse,
    WriteResult,
)


class ReadOnlySkillsBackend(StoreBackend):
    """Preserve StoreBackend reads while denying every mutation entry point.

    Seed the store through a regular StoreBackend before mounting this class.
    The async methods are overridden too: StoreBackend's async implementations
    access the store directly rather than delegating to these sync methods.
    """

    def write(self, file_path: str, content: str) -> WriteResult:
        return WriteResult(error=PERMISSION_DENIED)

    async def awrite(self, file_path: str, content: str) -> WriteResult:
        return self.write(file_path, content)

    def edit(
        self, file_path: str, old_string: str, new_string: str, replace_all: bool = False
    ) -> EditResult:
        return EditResult(error=PERMISSION_DENIED)

    async def aedit(
        self, file_path: str, old_string: str, new_string: str, replace_all: bool = False
    ) -> EditResult:
        return self.edit(file_path, old_string, new_string, replace_all)

    def delete(self, file_path: str) -> DeleteResult:
        return DeleteResult(error=PERMISSION_DENIED)

    async def adelete(self, file_path: str) -> DeleteResult:
        return self.delete(file_path)

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        return [FileUploadResponse(path=path, error=PERMISSION_DENIED) for path, _ in files]

    async def aupload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        return self.upload_files(files)
