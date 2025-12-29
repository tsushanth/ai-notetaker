'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { notesApi } from '@/lib/api';
import {
  ArrowLeft,
  FileText,
  Upload,
  Loader2,
  AlertCircle,
  X,
  File
} from 'lucide-react';

export default function UploadPdfPage() {
  const router = useRouter();
  const { token } = useAuthStore();
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (selectedFile: File) => {
    if (selectedFile.type !== 'application/pdf') {
      setError('Please select a PDF file');
      return;
    }

    if (selectedFile.size > 50 * 1024 * 1024) { // 50MB limit
      setError('File size must be less than 50MB');
      return;
    }

    setFile(selectedFile);
    setError(null);
    // Use file name as default title
    if (!title) {
      setTitle(selectedFile.name.replace('.pdf', ''));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleUpload = async () => {
    if (!file || !token) return;

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('pdf', file);
      if (title.trim()) {
        formData.append('title', title.trim());
      }

      const response = await notesApi.uploadPdf(token, formData);
      router.push(`/notes/${(response as { note: { id: string } }).note.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload PDF');
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/notes"
          className="p-2 hover:bg-[var(--surface-variant)] rounded-lg transition"
        >
          <ArrowLeft size={24} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Upload PDF</h1>
          <p className="text-[var(--text-secondary)]">
            Extract text from PDF documents
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-3 p-4 mb-6 bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/20 rounded-lg">
          <AlertCircle className="w-5 h-5 text-[var(--accent-red)]" />
          <p className="text-[var(--accent-red)]">{error}</p>
        </div>
      )}

      <div className="card">
        {/* Drop Zone */}
        {!file && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition ${
              isDragging
                ? 'border-[var(--accent-purple)] bg-[var(--accent-purple)]/10'
                : 'border-[var(--border)] hover:border-[var(--accent-purple)]'
            }`}
          >
            <FileText className="w-16 h-16 mx-auto mb-4 text-[var(--text-muted)]" />
            <p className="text-lg font-medium mb-2">
              Drop your PDF here
            </p>
            <p className="text-[var(--text-secondary)] mb-4">
              or click to browse
            </p>
            <p className="text-sm text-[var(--text-muted)]">
              Maximum file size: 50MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => {
                const selectedFile = e.target.files?.[0];
                if (selectedFile) {
                  handleFileSelect(selectedFile);
                }
              }}
              className="hidden"
            />
          </div>
        )}

        {/* Selected File */}
        {file && (
          <>
            <div className="flex items-center gap-4 p-4 bg-[var(--surface-variant)] rounded-lg mb-6">
              <div className="w-12 h-12 bg-[var(--accent-purple)]/20 rounded-lg flex items-center justify-center">
                <File className="w-6 h-6 text-[var(--accent-purple)]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{file.name}</p>
                <p className="text-sm text-[var(--text-muted)]">
                  {formatFileSize(file.size)}
                </p>
              </div>
              <button
                onClick={() => {
                  setFile(null);
                  setTitle('');
                }}
                className="p-2 hover:bg-[var(--border)] rounded-lg transition"
              >
                <X size={20} />
              </button>
            </div>

            {/* Title Input */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">
                Note Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter a title for your note"
                className="input"
              />
            </div>

            {/* Upload Button */}
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Processing PDF...
                </>
              ) : (
                <>
                  <Upload size={20} />
                  Extract & Create Note
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* Tips */}
      <div className="mt-6 p-4 bg-[var(--surface-variant)] rounded-lg">
        <p className="text-sm text-[var(--text-secondary)]">
          <strong>Tips:</strong> For best results, use PDFs with selectable text.
          Scanned documents will be processed using OCR.
        </p>
      </div>
    </div>
  );
}
