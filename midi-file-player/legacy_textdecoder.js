import {decodeNec932} from '../rcm2smf/nec932_decoder.js';

const decoderUtf8    = new TextDecoder('UTF-8');
const decoderCp932   = new TextDecoder('Shift_JIS');
const decoderLatin1  = new TextDecoder('Latin1');
const decoderUtf16le = new TextDecoder('UTF-16LE');
const decoderUtf16be = new TextDecoder('UTF-16BE');

const decoders = [
	(bytes) => decoderUtf8.decode(bytes),
	(bytes) => decoderCp932.decode(bytes),
	decodeNec932,
	(bytes) => decoderLatin1.decode(bytes),
];

export function decodeLegacyText(bytes) {
	console.assert(bytes && 'length' in bytes);

	// If the bytes start with BOM, decodes them as Unicode.
	if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		return decoderUtf16le.decode(bytes);
	} else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		return decoderUtf16be.decode(bytes);
	} else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return decoderUtf8.decode(bytes);
	}

	// Decodes the bytes by all the decoders.
	const results = [];
	for (let i = 0; i < decoders.length; i++) {
		// Decodes the bytes and checks the result.
		const text = decoders[i]((bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes));
		const indexNul = text.indexOf('\0');	// Some sequencers seems include '\0' in text meta events.
		const textNul = (indexNul >= 0) ? text.slice(0, indexNul) : text;
		const numUnknowns = (textNul.match(/\ufffd/ug) ?? []).length;
		const numOthers   = (textNul.match(/[\p{gc=Other}]/ug) ?? []).length;
		const numExcludes = (textNul.match(/[\t\n\r\x1a]/ug) ?? []).length;	// eslint-disable-line no-control-regex
			// Note: Some sequencers seems include '\x1a' in text meta events.

		// If the bytes can be converted UTF-8 (or ASCII) without problem, returns early.
		if (i === 0 && numUnknowns + numOthers === 0) {
			return text;
		}

		results.push({text, numUnknowns, numOthers, numExcludes, priority: i});
	}

	// Chooses the most appropriate result.
	const result = results.sort((a, b) => {
		const diffGarbles = (a.numUnknowns + a.numOthers - a.numExcludes) - (b.numUnknowns + b.numOthers - b.numExcludes);
		if (diffGarbles !== 0) {
			return diffGarbles;
		}
		const diffPriority = a.priority - b.priority;
		if (diffPriority !== 0) {
			return diffPriority;
		}
		return 0;
	})[0];

	return result.text;
}
