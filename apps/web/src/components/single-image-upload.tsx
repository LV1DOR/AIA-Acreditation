"use client";

import { AlertCircleIcon, ImageUpIcon, XIcon } from "lucide-react";
import { useFileUpload } from "../hooks/use-file-upload.ts";

export function SingleImageUpload({ help, label, name, prompt, required }: { help: string; label: string; name: string; prompt: string; required: boolean }) {
  const maxSizeMB = 150;
  const [{ files, isDragging, errors }, actions] = useFileUpload({ accept: "image/jpeg,image/png,image/webp,image/heic,image/heif", maxSize: maxSizeMB * 1024 * 1024 });
  const current = files[0];
  return <div className="single-image-field"><label>{label}</label><div className="single-image-drop" data-dragging={isDragging || undefined} data-has-file={current ? true : undefined} onClick={actions.openFileDialog} onDragEnter={actions.handleDragEnter} onDragLeave={actions.handleDragLeave} onDragOver={actions.handleDragOver} onDrop={actions.handleDrop} role="button" tabIndex={0} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") actions.openFileDialog(); }}>
    <input {...actions.getInputProps({ name, required, "aria-label": label, className: "sr-only" })}/>
    {current ? <img alt={current.file.name} src={current.preview}/> : <div className="single-image-prompt"><span><ImageUpIcon size={20}/></span><strong>{prompt}</strong><small>{maxSizeMB} MB</small></div>}
    {current && <button type="button" className="single-image-remove" aria-label="Remove image" onClick={event => { event.stopPropagation(); actions.removeFile(); }}><XIcon size={16}/></button>}
  </div>{errors.length > 0 && <p className="upload-error" role="alert"><AlertCircleIcon size={14}/>{errors[0]}</p>}<span className="field-help">{help}</span></div>;
}
