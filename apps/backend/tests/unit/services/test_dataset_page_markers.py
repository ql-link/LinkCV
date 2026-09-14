from unittest.mock import Mock

import pytest

from linkresume.services.dataset_content_service import read_markdown, strip_word_page_markers


@pytest.mark.parametrize('newline', ['\n', '\r\n'])
def test_removes_parser_pages_without_changing_body(newline):
    source = newline.join(['<!-- WORD_PAGE:1 -->', '# 标题', '', ' <!-- WORD_PAGE: 12 -->', '正文', '<!-- other comment -->'])
    expected = newline.join(['# 标题', '', '正文', '<!-- other comment -->'])
    assert strip_word_page_markers(source) == expected


@pytest.mark.parametrize('fence', ['```', '~~~~'])
def test_preserves_code_examples_and_inline_text(fence):
    source = f'{fence}html\n<!-- WORD_PAGE:1 -->\n{fence}\n    <!-- WORD_PAGE:2 -->\n正文 <!-- WORD_PAGE:3 -->\n<!-- WORD_PAGE:4 -->'
    assert strip_word_page_markers(source) == source.removesuffix('<!-- WORD_PAGE:4 -->')


def test_existing_stored_content_is_cleaned_on_read_without_rewriting():
    storage = Mock()
    storage.get.return_value = b'<!-- WORD_PAGE:1 -->\n# Title'
    assert read_markdown(storage, 'existing.md', 1024) == '# Title'
    storage.upload.assert_not_called()
