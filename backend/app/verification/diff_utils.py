"""Shared unified-diff parsing helpers for the deterministic verification layer."""

from __future__ import annotations

import re


def added_lines(diff_text: str) -> list[tuple[int, str]]:
    """Extract (line_number_in_new_file, content) pairs for added lines only."""
    added: list[tuple[int, str]] = []
    new_line_no = 0
    for raw_line in diff_text.splitlines():
        if raw_line.startswith("@@"):
            match = re.search(r"\+(\d+)", raw_line)
            new_line_no = int(match.group(1)) - 1 if match else new_line_no
            continue
        if raw_line.startswith("+++") or raw_line.startswith("---"):
            continue
        if raw_line.startswith("+"):
            new_line_no += 1
            added.append((new_line_no, raw_line[1:]))
        elif not raw_line.startswith("-"):
            new_line_no += 1
    return added


def added_line_numbers(diff_text: str) -> set[int]:
    """Line numbers (in the new file) touched by added diff lines."""
    return {line_no for line_no, _ in added_lines(diff_text)}
