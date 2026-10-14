import type { DragEvent } from "react";

import type { FileUIPart } from "ai";

import { IMAGE_FILE_PATTERN } from "@/lib/media";
import type { ToolOutput } from "@/lib/tool-parts";

export interface PendingImageAttachment extends FileUIPart {
  id: string;
  size: number;
  uploadError?: string;
  uploadedPath?: string;
  uploadedUrl?: string;
  uploadStatus: "error" | "pending" | "uploaded";
}

export interface UploadedImageAttachment {
  filename: string;
  mediaType: string;
  path: string;
  size: number;
  url: string;
}

export const MAX_PENDING_IMAGES = 8;

export function toFileUIPart(attachment: PendingImageAttachment): FileUIPart {
  if (!attachment.uploadedPath) {
    throw new Error("图片尚未上传成功，不能发送。");
  }

  return {
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    providerMetadata: {
      "admin-agent": {
        uploadedPath: attachment.uploadedPath,
        uploadedUrl: attachment.uploadedUrl,
      },
    },
    type: "file",
    url: attachment.url,
  };
}

export function readImageAttachment(
  file: File,
): Promise<PendingImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string" || reader.result.length === 0) {
        reject(new Error("图片读取结果为空"));
        return;
      }

      resolve({
        filename: file.name,
        id: createAttachmentId(),
        mediaType: file.type,
        size: file.size,
        type: "file",
        uploadStatus: "pending",
        url: reader.result,
      });
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export async function uploadImageFiles(
  files: File[],
): Promise<UploadedImageAttachment[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }

  const response = await fetch("/api/attachments/images", {
    body: formData,
    method: "POST",
  });
  const output = (await response.json()) as ToolOutput<
    UploadedImageAttachment[]
  >;

  if (!response.ok) {
    throw new Error(
      output.error ?? `图片上传接口返回 ${response.status}`,
    );
  }
  if (!output.ok) {
    throw new Error(output.error ?? "图片上传失败");
  }
  if (!Array.isArray(output.data)) {
    throw new Error("图片上传响应 data 必须是数组");
  }

  return output.data;
}

export function isImageFile(file: File) {
  return IMAGE_FILE_PATTERN.test(file.type);
}

export function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function createAttachmentId() {
  return crypto.randomUUID();
}
