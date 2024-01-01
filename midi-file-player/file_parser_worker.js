import {parseMidiFile} from '../midiana/lib/file-parser/midi_file_parser.js';

self.addEventListener('message', (e) => {
	for (const file of e.data) {
		try {
			// Reads the MIDI file.
			const reader = new FileReaderSync();
			const bytes = reader.readAsArrayBuffer(file);

			// Parses the MIDI data.
			const logs = [];
			const content = parseMidiFile(new Uint8Array(bytes), logs);
			if (logs.length > 0) {
				console.warn(...logs);
			}

			// If the MIDI data can be parsed successfully, returns it and breaks the loop.
			self.postMessage(content);
			break;

		} catch (e) {
			console.warn(`${file.name} is not a MIDI file:\n\t${e}`);
		}
	}
});
