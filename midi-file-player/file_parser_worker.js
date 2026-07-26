import {parseMidiFile} from '../midiana/lib/file-parser/midi_file_parser.js';
import {rcm2smf, defaultSettings} from '../rcm2smf/rcm_converter.js';
import {decodeNec932} from '../rcm2smf/nec932_decoder.js';

self.addEventListener('message', async (e) => {
	console.assert(Array.isArray(e.data));

	// Reads and parses each file as a MIDI file.
	const fileBytes = {};
	for (const file of e.data) {
		try {
			// Reads the file.
			const reader = new FileReaderSync();
			const bytes = new Uint8Array(reader.readAsArrayBuffer(file));

			fileBytes[file.name.toUpperCase()] = bytes;

			// Parses it as a MIDI data.
			const logs = [];
			const content = parseMidiFile(bytes, logs);
			if (logs.length > 0) {
				console.warn(...logs);
			}

			// If the MIDI data can be parsed successfully, returns it and breaks the handler.
			self.postMessage(content);
			return;

		} catch (e) {
			// Ignores and moves on the next file.
		}
	}

	// If none of the files are MIDI file, tries to convert each of them as a Recomposer file.
	for (const bytes of Object.values(fileBytes)) {
		try {
			// Converts the file as a Recomposer file.
			const smfData = await rcm2smf(new Uint8Array(bytes), fileReader, defaultSettings);

			// Parses the converted MIDI data.
			const logs = [];
			const content = parseMidiFile(smfData, logs);
			if (logs.length > 0) {
				console.warn(...logs);
			}

			// If the MIDI data can be parsed successfully, returns it and breaks the handler.
			self.postMessage(content);
			return;

		} catch (e) {
			// Ignores and moves on the next file.
		}
	}

	async function fileReader(fileName, fileNameRaw) {
		const fileNameUC = fileName.toUpperCase();
		if (fileBytes[fileNameUC]) {
			console.log(fileBytes[fileNameUC])
			return fileBytes[fileNameUC];
		}
		if (/^[\x20-\x7E]{9,}\.(?:MTD|CM6|GSD)$/u.test(fileName)) {
			const m = fileNameUC.match(/^([\x20-\x7E]{8}).*?\.(MTD|CM6|GSD)$/u);
			console.log(m)
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
