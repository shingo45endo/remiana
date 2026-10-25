import {makeArchiveError, normalizeOptions, createByteSource} from './archive_common.js';
import {isLzhArchive, findLzhHeaderOffset, openLzhArchive} from './lzh_archive.js';
import {isZipArchive, locateZipCentralDirectory, openZipArchive} from './zip_archive.js';

export {isLzhArchive, openLzhArchive, isZipArchive, openZipArchive};

// Opens an LZH or zip archive. The format is detected from the content, not from the file name.
export async function openArchive(source, options = {}) {
	const byteSource = createByteSource(source);
	const {maxHeaderScanSize} = normalizeOptions(options);

	// Checks the head first, which is cheap and covers normal archives.
	const headBytes = await byteSource.read(0, 64);
	if (isLzhArchive(headBytes)) {
		return openLzhArchive(byteSource, options);
	}
	if (isZipArchive(headBytes)) {
		return openZipArchive(byteSource, options);
	}

	// A self-extracting zip still has the End of Central Directory record at the tail.
	if (await locateZipCentralDirectory(byteSource)) {
		return openZipArchive(byteSource, options);
	}

	// A self-extracting LZH has the first header after the stub.
	if (await findLzhHeaderOffset(byteSource, maxHeaderScanSize) >= 0) {
		return openLzhArchive(byteSource, options);
	}

	throw makeArchiveError('Not an LZH or zip archive');
}
