"use client";

import type { ChangeEvent, DragEvent } from "react";
import { useRef, useState } from "react";

import {
  hasDraggedFiles,
  isImageFile,
  MAX_PENDING_IMAGES,
  readImageAttachment,
  uploadImageFiles,
  type PendingImageAttachment,
} from "@/lib/attachments";

export function useAttachments() {
  const [pendingImages, setPendingImages] = useState<PendingImageAttachment[]>(
    [],
  );
  const [attachmentError, setAttachmentError] = useState("");
  const [draggingImages, setDraggingImages] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const isUploadingImages = pendingImages.some(
    (image) => image.uploadStatus === "pending",
  );
  const hasAttachmentErrors = pendingImages.some(
    (image) => image.uploadStatus === "error",
  );

  async function addImageFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length !== files.length) {
      setAttachmentError("只能添加图片文件（image/*）。");
      return;
    }

    let imageParts: PendingImageAttachment[];
    try {
      imageParts = await Promise.all(imageFiles.map(readImageAttachment));
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "图片读取失败",
      );
      return;
    }
    // The cap is checked inside the functional update so concurrent
    // drops/selects cannot race past MAX_PENDING_IMAGES via a stale closure.
    let accepted = false;
    setPendingImages((current) => {
      if (current.length + imageParts.length > MAX_PENDING_IMAGES) {
        return current;
      }
      accepted = true;
      return [...current, ...imageParts];
    });
    if (!accepted) {
      setAttachmentError(
        `一次最多添加 ${MAX_PENDING_IMAGES} 张图片。`,
      );
      return;
    }

    setAttachmentError("");

    try {
      const uploadedImages = await uploadImageFiles(imageFiles);
      if (uploadedImages.length !== imageParts.length) {
        throw new Error(
          `图片上传返回数量不一致：期望 ${imageParts.length}，实际 ${uploadedImages.length}`,
        );
      }

      setPendingImages((current) =>
        current.map((image) => {
          const imageIndex = imageParts.findIndex(
            (item) => item.id === image.id,
          );
          if (imageIndex < 0) {
            return image;
          }

          const uploaded = uploadedImages[imageIndex]!;

          return {
            ...image,
            filename: uploaded.filename,
            mediaType: uploaded.mediaType,
            size: uploaded.size,
            uploadedPath: uploaded.path,
            uploadedUrl: uploaded.url,
            uploadStatus: "uploaded",
          };
        }),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "图片上传失败，请重试。";
      setAttachmentError(message);
      setPendingImages((current) =>
        current.map((image) =>
          imageParts.some((item) => item.id === image.id)
            ? { ...image, uploadError: message, uploadStatus: "error" }
            : image,
        ),
      );
    }
  }

  function handleAttachmentInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void addImageFiles(files);
  }

  function handlePromptDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDraggingImages(true);
  }

  function handlePromptDragLeave(event: DragEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }

    setDraggingImages(false);
  }

  function handlePromptDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    setDraggingImages(false);
    void addImageFiles(Array.from(event.dataTransfer.files));
  }

  function removePendingImage(id: string) {
    setPendingImages((current) => current.filter((item) => item.id !== id));
    setAttachmentError("");
  }

  /** Clears every attachment-related piece of state (send / session switch). */
  function resetAttachments() {
    setPendingImages([]);
    setDraggingImages(false);
    setAttachmentError("");
  }

  return {
    attachmentError,
    attachmentInputRef,
    draggingImages,
    handleAttachmentInputChange,
    handlePromptDragLeave,
    handlePromptDragOver,
    handlePromptDrop,
    hasAttachmentErrors,
    isUploadingImages,
    pendingImages,
    removePendingImage,
    resetAttachments,
    setAttachmentError,
  };
}
