"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Cropper, { type Area } from "react-easy-crop";
import Slider from "@mui/material/Slider";
import RotateLeftIcon from "@mui/icons-material/RotateLeft";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import { AlertCircleIcon, ImageUpIcon, PencilIcon, XIcon } from "lucide-react";

const MAX_SOURCE_SIZE = 8 * 1024 * 1024;
const ui = {
  pt: { title: "Ajustar fotografia", help: "Posicione o rosto dentro da área e ajuste o enquadramento.", zoom: "Zoom", rotate: "Rotação", left: "Rodar à esquerda", right: "Rodar à direita", cancel: "Cancelar", use: "Usar fotografia", edit: "Ajustar fotografia", replace: "Escolher outra", remove: "Remover fotografia", close: "Fechar", tooLarge: "A imagem excede 8 MB.", unsupported: "Escolha uma imagem JPEG ou PNG.", failed: "Não foi possível processar esta imagem." },
  en: { title: "Adjust photo", help: "Position the face inside the area and adjust the framing.", zoom: "Zoom", rotate: "Rotation", left: "Rotate left", right: "Rotate right", cancel: "Cancel", use: "Use photo", edit: "Adjust photo", replace: "Choose another", remove: "Remove photo", close: "Close", tooLarge: "The image exceeds 8 MB.", unsupported: "Choose a JPEG or PNG image.", failed: "This image could not be processed." },
} as const;

export function SingleImageUpload({ help, label, locale, name, prompt, required, existingPhotoUrl, variant = "profile", aspect = 1, outputWidth = 1200, outputHeight = 1200 }: { help: string; label: string; locale: "pt" | "en"; name: string; prompt: string; required: boolean; existingPhotoUrl?: string; variant?: "profile" | "banner"; aspect?: number; outputWidth?: number; outputHeight?: number }) {
  const labels = ui[locale];
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptedFile = useRef<File | null>(null);
  const sourceObjectUrl = useRef<string | null>(null);
  const previewObjectUrl = useRef<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(existingPhotoUrl ?? null);
  const [sourceName, setSourceName] = useState("profile.jpg");
  const [open, setOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => () => {
    if (sourceObjectUrl.current) URL.revokeObjectURL(sourceObjectUrl.current);
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
  }, []);

  const beginCrop = useCallback((file: File) => {
    if (file.size > MAX_SOURCE_SIZE) { setError(labels.tooLarge); if (inputRef.current) inputRef.current.value = ""; return; }
    if (!["image/jpeg", "image/png"].includes(file.type)) { setError(labels.unsupported); if (inputRef.current) inputRef.current.value = ""; return; }
    if (sourceObjectUrl.current) URL.revokeObjectURL(sourceObjectUrl.current);
    const url = URL.createObjectURL(file); sourceObjectUrl.current = url;
    if (inputRef.current) {
      const transfer = new DataTransfer(); if (acceptedFile.current) transfer.items.add(acceptedFile.current); inputRef.current.files = transfer.files;
    }
    setSource(url); setSourceName(file.name); setCrop({ x: 0, y: 0 }); setZoom(1); setRotation(0); setPixels(null); setError(null); setOpen(true);
  }, [labels.tooLarge, labels.unsupported]);

  function onFile(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (file) beginCrop(file); }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) beginCrop(file); }
  async function editCurrent() {
    if (source) { setOpen(true); return; }
    if (!preview) return;
    try {
      const response = await fetch(preview, { credentials: "same-origin" });
      if (!response.ok) throw new Error("PHOTO_FETCH_FAILED");
      beginCrop(new File([await response.blob()], "profile.jpg", { type: response.headers.get("content-type") || "image/jpeg" }));
    } catch { setError(labels.failed); }
  }
  async function confirmCrop() {
    if (!source || !pixels || !inputRef.current) return;
    setProcessing(true);
    try {
      const blob = await cropImage(source, pixels, rotation, outputWidth, outputHeight);
      const file = new File([blob], sourceName.replace(/\.[^.]+$/, "") + "-cropped.jpg", { type: "image/jpeg", lastModified: Date.now() });
      const transfer = new DataTransfer(); transfer.items.add(file); inputRef.current.files = transfer.files; acceptedFile.current = file;
      if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
      const url = URL.createObjectURL(file); previewObjectUrl.current = url; setPreview(url); setError(null); setOpen(false);
    } catch { setError(labels.failed); }
    finally { setProcessing(false); }
  }
  function remove() { if (inputRef.current) inputRef.current.value = ""; acceptedFile.current = null; if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current); previewObjectUrl.current = null; setPreview(null); setSource(null); setError(null); }

  return <div className={`single-image-field ${variant === "banner" ? "banner-image-field" : ""}`}><label>{label}</label><input ref={inputRef} name={name} required={required} aria-label={label} className="sr-only" type="file" accept="image/jpeg,image/png" onChange={onFile}/>
    {preview ? <div className="single-image-preview"><img alt="" src={preview}/><div className="single-image-actions"><button type="button" className="button secondary" onClick={editCurrent}><PencilIcon size={15}/>{labels.edit}</button><button type="button" className="button secondary" onClick={() => inputRef.current?.click()}><ImageUpIcon size={15}/>{labels.replace}</button><button type="button" className="icon-button" onClick={remove} aria-label={labels.remove}><XIcon size={17}/></button></div></div> : <div className="single-image-drop" data-dragging={dragging || undefined} onClick={() => inputRef.current?.click()} onDragEnter={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { event.preventDefault(); setDragging(false); }} onDragOver={event => event.preventDefault()} onDrop={onDrop} role="button" tabIndex={0} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}><div className="single-image-prompt"><span><ImageUpIcon size={20}/></span><strong>{prompt}</strong><small>JPEG, PNG · 8 MB</small></div></div>}
    {error && <p className="upload-error" role="alert"><AlertCircleIcon size={14}/>{error}</p>}<span className="field-help">{help}</span>
    {open && source && <div className="portal-modal-backdrop photo-crop-backdrop" role="presentation"><section className="portal-modal photo-crop-modal" role="dialog" aria-modal="true" aria-labelledby={`${name}-crop-title`}><header><div><h2 id={`${name}-crop-title`}>{labels.title}</h2><p>{labels.help}</p></div><button className="modal-close" type="button" onClick={() => setOpen(false)} aria-label={labels.close}>×</button></header><div className={`photo-crop-stage ${variant === "banner" ? "banner-crop-stage" : ""}`}><Cropper image={source} crop={crop} zoom={zoom} rotation={rotation} aspect={aspect} cropShape={variant === "banner" ? "rect" : "round"} showGrid={false} onCropChange={setCrop} onZoomChange={setZoom} onRotationChange={setRotation} onCropComplete={(_, area) => setPixels(area)}/></div><div className="photo-crop-controls"><label><span>{labels.zoom}</span><Slider size="small" min={1} max={3} step={0.01} value={zoom} onChange={(_, value) => setZoom(value as number)} aria-label={labels.zoom}/></label><div><span>{labels.rotate}</span><button type="button" className="icon-button" onClick={() => setRotation(value => value - 90)} aria-label={labels.left}><RotateLeftIcon fontSize="small"/></button><button type="button" className="icon-button" onClick={() => setRotation(value => value + 90)} aria-label={labels.right}><RotateRightIcon fontSize="small"/></button></div></div><footer><button className="button secondary" type="button" onClick={() => setOpen(false)}>{labels.cancel}</button><button className="button primary" type="button" disabled={processing || !pixels} onClick={confirmCrop}>{labels.use}</button></footer></section></div>}
  </div>;
}

async function cropImage(source: string, crop: Area, rotation: number, outputWidth: number, outputHeight: number) {
  const image = await loadImage(source);
  const radians = rotation * Math.PI / 180;
  const width = Math.abs(Math.cos(radians) * image.width) + Math.abs(Math.sin(radians) * image.height);
  const height = Math.abs(Math.sin(radians) * image.width) + Math.abs(Math.cos(radians) * image.height);
  const rotated = document.createElement("canvas"); rotated.width = Math.ceil(width); rotated.height = Math.ceil(height);
  const context = rotated.getContext("2d"); if (!context) throw new Error("CANVAS_UNAVAILABLE");
  context.translate(rotated.width / 2, rotated.height / 2); context.rotate(radians); context.drawImage(image, -image.width / 2, -image.height / 2);
  const output = document.createElement("canvas"); output.width = outputWidth; output.height = outputHeight;
  const outputContext = output.getContext("2d"); if (!outputContext) throw new Error("CANVAS_UNAVAILABLE");
  outputContext.drawImage(rotated, crop.x, crop.y, crop.width, crop.height, 0, 0, outputWidth, outputHeight);
  return new Promise<Blob>((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error("IMAGE_EXPORT_FAILED")), "image/jpeg", 0.9));
}

function loadImage(source: string) { return new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source; }); }
