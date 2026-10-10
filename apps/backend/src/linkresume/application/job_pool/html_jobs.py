"""Narrow readers for the registered official HTML job detail templates."""
from html.parser import HTMLParser

from linkresume.application.job_pool.types import clean_text


class HaierDetail(HTMLParser):
    """Read labelled job sections and the current job's collection identifier."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.identifiers = set()
        self.sections = {}
        self.heading = None
        self.label = None
        self.content = None
        self.depth = 0
        self.parts = []
        self.ignored = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get("class") or "").split()
        if "collection" in classes and attrs.get("data-id"):
            self.identifiers.add(attrs["data-id"])
        if tag in {"script", "style"}:
            self.ignored += 1
        if tag == "div":
            self.depth += 1
            if self.heading is None and self.content is None:
                if "title1" in classes:
                    self.heading = self.depth
                    self.parts = []
                elif self.label and "cb-wordwrap" in classes:
                    self.content = self.depth
                    self.parts = []
        if (self.heading or self.content) and tag in {"br", "p", "li", "div"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.ignored = max(0, self.ignored - 1)
        if tag == "div":
            if self.depth == self.heading:
                self.label = "".join(self.parts).strip()
                self.heading = None
            elif self.depth == self.content:
                if self.label in self.sections:
                    raise ValueError("duplicate official job section")
                self.sections[self.label] = clean_text("".join(self.parts))
                self.content = self.label = None
            self.depth -= 1
        if self.content and tag in {"p", "li", "div"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.ignored and (self.heading or self.content):
            self.parts.append(data)

    def description(self, identifier):
        if self.identifiers != {str(identifier)}:
            raise ValueError("mismatched official job identifier")
        duty, requirements = self.sections.get("职责描述"), self.sections.get("任职要求")
        if not duty or not requirements:
            raise ValueError("missing full official job sections")
        return duty + "\n\n" + requirements
