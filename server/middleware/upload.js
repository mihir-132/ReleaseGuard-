import multer from 'multer';

// Store uploads in memory so we can stream them to disk after validation.
// 50 MB is a generous limit for a release bundle ZIP.
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const storage = multer.memoryStorage();

function fileFilter(_req, file, cb) {
  const isZip =
    file.mimetype === 'application/zip' ||
    file.mimetype === 'application/x-zip-compressed' ||
    file.originalname.toLowerCase().endsWith('.zip');

  if (isZip) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error('Only ZIP files are accepted.'), { status: 400 }));
  }
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

export default upload;
