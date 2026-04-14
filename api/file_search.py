import os

from helpers.api import ApiHandler, Request, Response
from helpers import runtime, files, projects


_SKIP_DIRS = frozenset({
    "__pycache__", "node_modules", ".git", ".svn", ".hg",
    ".DS_Store", "venv", ".venv", ".tox", ".mypy_cache",
    ".pytest_cache", ".idea", ".vscode", ".a0proj", ".npm",
    ".cache", "dist", "build", ".next", ".nuxt",
})

MAX_FILES = 500
MAX_DEPTH = 8


class FileSearch(ApiHandler):

    @classmethod
    def get_methods(cls):
        return ["POST"]

    async def process(self, input: dict, request: Request) -> dict | Response:
        ctxid = input.get("ctxid", "")
        base_path = input.get("path", "")
        query = input.get("query", "").lower().strip()

        if not base_path:
            base_path = await self._resolve_project_path(ctxid)

        base_path = _normalize(base_path)
        if not base_path or not os.path.isdir(base_path):
            base_path = "/a0"

        # Restrict to /a0 subtree — prevent path traversal
        if not base_path.startswith("/a0/"):
            base_path = "/a0"

        result = await runtime.call_development_function(
            _walk_files, base_path, query
        )

        return {
            "ok": True,
            "base_path": base_path,
            "files": result,
        }

    async def _resolve_project_path(self, ctxid: str) -> str:
        if not ctxid:
            return "/a0"
        try:
            context = self.use_context(ctxid)
            project_name = projects.get_context_project_name(context)
            if project_name:
                return str(projects.get_project_folder(project_name))
        except Exception:
            pass
        return "/a0"


def _normalize(path: str) -> str:
    if hasattr(files, "normalize_a0_path"):
        return files.normalize_a0_path(path)
    return os.path.normpath(path) if path else ""


def _walk_files(base_path: str, query: str) -> list[dict]:
    results = []
    base_len = len(base_path.rstrip("/")) + 1

    for root, dirs, filenames in os.walk(base_path):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
        depth = root.replace(base_path, "").count(os.sep)
        if depth >= MAX_DEPTH:
            dirs.clear()
            continue

        rel_root = root[base_len:] if len(root) >= base_len else ""

        for name in dirs:
            rel = os.path.join(rel_root, name) if rel_root else name
            if not query or query in rel.lower():
                results.append({
                    "path": rel,
                    "name": name,
                    "is_dir": True,
                })
                if len(results) >= MAX_FILES:
                    return results

        for name in filenames:
            rel = os.path.join(rel_root, name) if rel_root else name
            if not query or query in rel.lower():
                results.append({
                    "path": rel,
                    "name": name,
                    "is_dir": False,
                })
                if len(results) >= MAX_FILES:
                    return results

    results.sort(key=lambda e: (not e["is_dir"], e["path"].lower()))
    return results
