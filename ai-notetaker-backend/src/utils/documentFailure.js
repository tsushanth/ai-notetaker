/**
 * Context for the "document_processing_failed" failure report.
 * The report used to carry only step / mime / size, so an unreadable (scanned or image-only) PDF,
 * a failed storage download and a crashed extractor all looked identical. Adds the cause.
 * Only fixed app messages and the error class name are used: never file names, user ids or document text.
 */
function documentFailureContext(job, error) {
  const isApp = !!error && typeof error.statusCode === 'number';
  let reason;
  if (isApp && typeof error.message === 'string') {
    // AppError messages are authored in the app; a storage download failure appends the storage service's own text.
    reason = error.message.replace(/uploads\/\S+/g, 'uploads/<path>').slice(0, 120);
  } else {
    reason = (error && error.name) || 'Error';
  }
  return {
    step: String(job.steps.findIndex(s => s.status === 'in_progress')),
    mime: String(job.mimeType || 'unknown').slice(0, 80),
    size_kb: String(Math.round((job.fileSize || 0) / 1024)),
    reason,
    http: isApp ? String(error.statusCode) : 'none'
  };
}

module.exports = { documentFailureContext };
