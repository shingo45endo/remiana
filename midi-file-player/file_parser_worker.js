import {parseMidiFile} from '../midiana/lib/file-parser/midi_file_parser.js';
import {rcm2smf, defaultSettings} from '../rcm2smf/rcm_converter.js';
import {decodeNec932} from '../rcm2smf/nec932_decoder.js';
import {openArchive} from '../archive-reader/archive.js';

// How deep nested archives (an archive in an archive) are expanded.
const maxArchiveDepth = 2;

// A file larger than this cannot be MIDI or Recomposer data, so it is not read at all.
const maxFileSize = 16 * 1024 * 1024;

// The total size of the files kept in memory is limited, so that a huge archive does not take forever.
const maxTotalSize = 256 * 1024 * 1024;

self.addEventListener('message', async (e) => {
	console.assert(Array.isArray(e.data));

	// Reads each file. The files in an archive (LZH or zip) are treated as if they were dropped together.
	const fileBytes = {};
	let totalSize = 0;
	for (const file of e.data) {
		try {
			await addFile(file.name, file, maxArchiveDepth);

		} catch (e) {
			// Ignores and moves on the next file.
			console.warn(e);
		}
	}

	// Parses each file as a MIDI file.
	for (const bytes of Object.values(fileBytes)) {
		try {
			const logs = [];
			const content = parseMidiFile(bytes, {}, logs);
			if (logs.length > 0) {
				console.warn(...logs);
			}

			// If the MIDI data can be parsed successfully, returns it and breaks the handler.
			// Note: A song without time (the division of the MThd gives no time base) cannot be played.
			if (content.song && content.song.tempoMap.get(0).usec !== undefined) {
				self.postMessage(content);
				return;
			}

		} catch (e) {
			// Ignores and moves on the next file.
			console.warn(e);
		}
	}

	// If none of the files are MIDI file, tries to convert each of them as a Recomposer file.
	for (const bytes of Object.values(fileBytes)) {
		try {
			// Converts the file as a Recomposer file.
			const smfData = await rcm2smf(new Uint8Array(bytes), fileReader, defaultSettings);

			// Parses the converted MIDI data.
			const logs = [];
			const content = parseMidiFile(smfData, {}, logs);
			if (logs.length > 0) {
				console.warn(...logs);
			}

			// If the MIDI data can be parsed successfully, returns it and breaks the handler.
			// Note: A song without time (the division of the MThd gives no time base) cannot be played.
			if (content.song && content.song.tempoMap.get(0).usec !== undefined) {
				self.postMessage(content);
				return;
			}

		} catch (e) {
			// Ignores and moves on the next file.
		}
	}

	// Notifies that none of the files can be played.
	self.postMessage(null);

	// Adds the file (a File or a Uint8Array) to the table, or the files in it if it is an archive.
	async function addFile(fileName, source, archiveDepth) {
		if (archiveDepth > 0) {
			// Tries to open the file as an archive. A File is read partially, so a huge archive costs only its headers.
			let archive = null;
			try {
				// Decodes the file names in the same way as the control file names in a Recomposer file, so that they match.
				archive = await openArchive(source, {decodeFileName: decodeNec932});
			} catch {
				// Not an archive. Treats it as a plain file.
			}

			if (archive) {
				for (const entry of archive.entries) {
					if (entry.isDirectory || entry.originalSize > maxFileSize) {
						continue;
					}
					if (totalSize + entry.originalSize > maxTotalSize) {
						console.warn(`Stopped expanding the archive: ${fileName}`);
						break;
					}
					try {
						// Only the base name is kept because the control file names in a Recomposer file have no directory.
						await addFile(entry.name, await archive.readEntry(entry), archiveDepth - 1);
					} catch (e) {
						// Ignores the entry (unsupported method, broken data, etc.) and moves on the next entry.
						console.warn(e);
					}
				}
				return;
			}
		}

		const size = (source instanceof Blob) ? source.size : source.length;
		if (size > maxFileSize || totalSize + size > maxTotalSize) {
			console.warn(`Skipped the file: ${fileName} (${size} bytes)`);
			return;
		}

		const bytes = (source instanceof Blob) ? new Uint8Array(new FileReaderSync().readAsArrayBuffer(source)) : source;
		fileBytes[fileName.toUpperCase()] = bytes;
		totalSize += bytes.length;
	}

	async function fileReader(fileName, fileNameRaw) {
		const fileNameUC = fileName.toUpperCase();
		if (fileBytes[fileNameUC]) {
			return fileBytes[fileNameUC];
		}
		if (/^[\x20-\x7E]{9,}\.(?:MTD|CM6|GSD)$/u.test(fileName)) {
			const m = fileNameUC.match(/^([\x20-\x7E]{8}).*?\.(MTD|CM6|GSD)$/u);
			if (m) {
				const truncatedFileNameUC = `${m[1]}.${m[2]}`;
				if (fileBytes[truncatedFileNameUC]) {
					return fileBytes[truncatedFileNameUC];
				}
			}
		}

		const decodedFileNameUC = decodeNec932(fileNameRaw).toUpperCase();
		if (fileBytes[decodedFileNameUC]) {
			return fileBytes[decodedFileNameUC];
		}
		if (/^[\x20-\xFC]{9,}\.(?:MTD|CM6|GSD)$/u.test(fileName)) {
			const m = fileNameRaw.match(/^([\x20-\xFC]{8}).*?\.(MTD|CM6|GSD)$/u);
			if (m) {
				const truncatedFileNameUC = `${decodeNec932(m[1]).toUpperCase()}.${m[2]}`;
				if (fileBytes[truncatedFileNameUC]) {
					return fileBytes[truncatedFileNameUC];
				}
			}
		}

		return null;
	}
});
