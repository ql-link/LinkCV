import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { cn } from "@/lib/utils";
import "./file-upload.css";

export type FileUploadHandle = {
  focus: () => void;
  open: () => void;
};

type FileUploadProps = {
  accept: string;
  inputLabel: string;
  supportingText: string;
  onFileSelect: (file: File | undefined) => void;
  browseLabel?: string;
  className?: string;
  disabled?: boolean;
  file?: File | null;
  name?: string;
  replaceLabel?: string;
};

export const FileUpload = forwardRef<FileUploadHandle, FileUploadProps>(function FileUpload({
  accept,
  inputLabel,
  supportingText,
  onFileSelect,
  browseLabel = "浏览文件",
  className,
  disabled = false,
  file = null,
  name = "import-file",
  replaceLabel = "重新选择",
}, forwardedRef) {
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const open = () => {
    if (!disabled) inputRef.current?.click();
  };

  useImperativeHandle(forwardedRef, () => ({
    focus: () => triggerRef.current?.focus(),
    open,
  }));

  const selectFile = (selected: File | undefined) => {
    setDragActive(false);
    onFileSelect(selected);
  };

  return (
    <div className={cn("file-upload", className)}>
      <button
        ref={triggerRef}
        type="button"
        className={cn("file-upload-dropzone", dragActive && "is-dragging")}
        disabled={disabled}
        onClick={open}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!disabled) selectFile(event.dataTransfer.files?.[0]);
        }}
      >
        <span className="file-upload-icon" aria-hidden="true"><FileUp /></span>
        <span className="file-upload-copy">
          <strong>{file ? "点击重新选择或拖放文件替换" : "点击上传或拖放文件"}</strong>
          <small>{supportingText}</small>
          <span className="file-upload-browse"><FileUp aria-hidden="true" />{file ? replaceLabel : browseLabel}</span>
        </span>
      </button>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        name={name}
        aria-label={inputLabel}
        accept={accept}
        disabled={disabled}
        tabIndex={-1}
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          selectFile(selected);
        }}
      />
    </div>
  );
});
