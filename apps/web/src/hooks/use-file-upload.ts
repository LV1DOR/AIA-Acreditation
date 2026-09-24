"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type InputHTMLAttributes } from "react";

type UploadFile = { file: File; id: string; preview: string };

export function useFileUpload({ accept, maxSize }: { accept: string; maxSize: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<UploadFile | null>(null);
  const [isDragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => () => { if (file?.preview) URL.revokeObjectURL(file.preview); }, [file]);

  const addFile = useCallback((next: File | undefined) => {
    if (!next) return;
    if (next.size > maxSize) {
      if (inputRef.current) inputRef.current.value = "";
      setFile(null);
      setErrors([`File exceeds the maximum size of ${Math.round(maxSize / 1024 / 1024)} MB.`]);
      return;
    }
    if (!next.type.startsWith("image/")) {
      if (inputRef.current) inputRef.current.value = "";
      setFile(null);
      setErrors(["Select a supported image file."]);
      return;
    }
    setErrors([]); setFile({ file: next, id: `${next.name}-${next.lastModified}`, preview: URL.createObjectURL(next) });
  }, [maxSize]);
  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => addFile(event.target.files?.[0]), [addFile]);
  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault(); event.stopPropagation(); setDragging(false);
    const next = event.dataTransfer.files?.[0]; if (!next) return;
    const transfer = new DataTransfer(); transfer.items.add(next); if (inputRef.current) inputRef.current.files = transfer.files; addFile(next);
  }, [addFile]);
  const removeFile = useCallback(() => { if (inputRef.current) inputRef.current.value = ""; setFile(null); setErrors([]); }, []);
  const getInputProps = useCallback((props: InputHTMLAttributes<HTMLInputElement> = {}) => ({ ...props, accept, onChange: handleFileChange, ref: inputRef, type: "file" as const }), [accept, handleFileChange]);
  return [{ files: file ? [file] : [], isDragging, errors }, { getInputProps, handleDragEnter: (event: DragEvent<HTMLElement>) => { event.preventDefault(); setDragging(true); }, handleDragLeave: (event: DragEvent<HTMLElement>) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }, handleDragOver: (event: DragEvent<HTMLElement>) => event.preventDefault(), handleDrop, openFileDialog: () => inputRef.current?.click(), removeFile }] as const;
}
