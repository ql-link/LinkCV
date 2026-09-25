import { File, FileVideo2 } from "lucide-react";

import audioIcon from "../../../assets/dataset-file-icons/audio.svg";
import markdownIcon from "../../../assets/dataset-file-icons/markdown.svg";
import pdfIcon from "../../../assets/dataset-file-icons/pdf.svg";
import selectFileIcon from "../../../assets/dataset-file-icons/select-file.svg";
import txtIcon from "../../../assets/dataset-file-icons/txt.svg";
import wordIcon from "../../../assets/dataset-file-icons/word.svg";

import type { DatasetRecord } from "../../../api/client";

const FORMAT_ICONS: Record<string, string> = {
  doc: wordIcon,
  docx: wordIcon,
  md: markdownIcon,
  markdown: markdownIcon,
  pdf: pdfIcon,
  txt: txtIcon,
};

export function DatasetFileTypeIcon({
  dataset,
  size = 48,
}: {
  dataset: Pick<DatasetRecord, "asset_kind" | "file_format">;
  size?: number;
}) {
  const format = dataset.file_format.toLowerCase();
  const source = dataset.asset_kind === "audio" ? audioIcon : FORMAT_ICONS[format];

  if (source) {
    return <img className="dataset-file-type-icon" src={source} width={size} height={size} alt="" />;
  }
  if (dataset.asset_kind === "video") {
    return <FileVideo2 className="dataset-file-type-icon is-generic" width={size} height={size} aria-hidden="true" />;
  }
  return <File className="dataset-file-type-icon is-generic" width={size} height={size} aria-hidden="true" />;
}

export function DatasetSelectFileIcon({ size = 48 }: { size?: number }) {
  return <img className="dataset-file-type-icon" src={selectFileIcon} width={size} height={size} alt="" />;
}
