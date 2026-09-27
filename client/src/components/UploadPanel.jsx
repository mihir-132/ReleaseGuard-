import { useState, useRef, useCallback } from 'react';
import { uploadBundle } from '../api/upload.js';

/**
 * UploadPanel — drag-and-drop / file-picker ZIP upload.
 *
 * @param {{ onUpload: (runId: string) => void }} props
 */
function UploadPanel({ onUpload }) {
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const isZip = (file) =>
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed' ||
    file.name.toLowerCase().endsWith('.zip');

  const handleFile = useCallback((file) => {
    if (!isZip(file)) {
      setError(`"${file.name}" is not a ZIP file. Please select a .zip bundle.`);
      setSelectedFile(null);
      return;
    }
    setError(null);
    setSelectedFile(file);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => setDragging(false);

  const handleInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setError(null);

    try {
      const { runId } = await uploadBundle(selectedFile);
      onUpload(runId);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-panel">
      <div className="upload-header">
        <h1 className="upload-title">ReleaseGuard</h1>
        <p className="upload-subtitle">
          AI-powered release readiness analysis for Node.js applications
        </p>
      </div>

      <form className="upload-form" onSubmit={handleSubmit}>
        <div
          className={`drop-zone${dragging ? ' drop-zone--active' : ''}${selectedFile ? ' drop-zone--selected' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          aria-label="Drop ZIP bundle here or click to browse"
        >
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="drop-zone__input"
            onChange={handleInputChange}
            aria-hidden="true"
            tabIndex={-1}
          />
          <div className="drop-zone__icon" aria-hidden="true">📦</div>
          {selectedFile ? (
            <p className="drop-zone__filename">{selectedFile.name}</p>
          ) : (
            <>
              <p className="drop-zone__primary">Drop your release bundle here</p>
              <p className="drop-zone__secondary">or click to browse — .zip files only</p>
            </>
          )}
        </div>

        {error && (
          <p className="upload-error" role="alert">{error}</p>
        )}

        <button
          type="submit"
          className="btn-analyze"
          disabled={!selectedFile || uploading}
        >
          {uploading ? 'Uploading…' : 'Analyze Release'}
        </button>
      </form>
    </div>
  );
}

export default UploadPanel;
