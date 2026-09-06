import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
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
  onFileSelect?: (file: File | undefined) => void;
  onFilesSelect?: (files: File[]) => void;
  browseLabel?: string;
  className?: string;
  children?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  file?: File | null;
  multiple?: boolean;
  name?: string;
  replaceLabel?: string;
};

export const FileUpload = forwardRef<FileUploadHandle, FileUploadProps>(function FileUpload({
  accept,
  inputLabel,
  supportingText,
  onFileSelect,
  onFilesSelect,
  browseLabel = "浏览文件",
  className,
  children,
  icon = <FileUp />,
  disabled = false,
  file = null,
  multiple = false,
  name = "import-file",
  replaceLabel = "重新选择",
}, forwardedRef) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastHandledFilesRef = useRef<File[] | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const open = () => {
    if (disabled) return;
    const input = inputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  useImperativeHandle(forwardedRef, () => ({
    focus: () => inputRef.current?.focus(),
    open,
  }));

  const selectFiles = (selectedFiles: FileList | File[] | null | undefined) => {
    setDragActive(false);
    const files = selectedFiles ? Array.from(selectedFiles) : [];
    if (multiple || onFilesSelect) {
      if (onFilesSelect) onFilesSelect(files);
      else onFileSelect?.(files[0]);
      return;
    }
    onFileSelect?.(files[0]);
  };

  const handleNativeSelection = (input: HTMLInputElement) => {
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) return;
    const previous = lastHandledFilesRef.current;
    if (previous?.length === files.length && previous.every((file, index) => file === files[index])) {
      return;
    }
    lastHandledFilesRef.current = files;
    selectFiles(files);
  };

  return (
    <div className={cn("file-upload", disabled && "is-disabled", className)}>
      <div className="file-upload-picker">
        <div
          className={cn("file-upload-dropzone", dragActive && "is-dragging")}
          aria-hidden="true"
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
            if (!disabled) selectFiles(event.dataTransfer.files);
          }}
        >
          <span className="file-upload-icon" aria-hidden="true">{icon}</span>
          <span className="file-upload-copy">
            <strong>{file ? "点击重新选择或拖放文件替换" : multiple ? "点击上传或拖放多个文件" : "点击上传或拖放文件"}</strong>
            <small>{supportingText}</small>
            <span className="file-upload-browse"><FileUp aria-hidden="true" />{file ? replaceLabel : browseLabel}</span>
          </span>
        </div>
        <input
          ref={inputRef}
          className="file-upload-native-input"
          type="file"
          name={name}
          aria-label={inputLabel}
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onClick={(event) => {
            // Clear before the native picker opens so choosing the same file
            // again still produces a selection event.
            lastHandledFilesRef.current = null;
            event.currentTarget.value = "";
          }}
          onDragEnter={() => {
            if (!disabled) setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            if (!disabled) selectFiles(event.dataTransfer.files);
          }}
          onInput={(event) => handleNativeSelection(event.currentTarget)}
          onChange={(event) => handleNativeSelection(event.currentTarget)}
        />
      </div>
      {children}
    </div>
  );
});
