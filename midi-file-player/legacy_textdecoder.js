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

function decodeNec932(bytes) {
	// Note: This function doesn't support "2-byte half-width" characters assigned to 0x8540-0x869e.

	// Checks whether the bytes seem to contain NEC box-drawing characters.
	if ([...bytes].some((e, i, a) => isPc98BoxDrawing((i > 0) && (a[i - 1] << 8) | e))) {	// It allows false positive.
		// Separates from the bytes to each character code according to Shift_JIS encoding.
		let leadingByte = -1;
		const charArrays = [...bytes].reduce((p, c) => {
			if (leadingByte >= 0) {
				p.push([leadingByte, c]);
				leadingByte = -1;
			} else if ((0x81 <= c && c <= 0x9f) || (0xe0 <= c && c <= 0xfc)) {
				leadingByte = c;
			} else {
				p.push([c]);
			}
			return p;
		}, []);

		// Replaces NEC box-drawing characters into Unicode's ones.
		return charArrays.map((e) => {
			const cp932code =  (e[0] << 8) | e[1];
			return (isPc98BoxDrawing(cp932code) ? String.fromCodePoint(cp932code - 0x61a2) : decoderCp932.decode(new Uint8Array(e)));
		}).join('');

	} else {
		return decoderCp932.decode(bytes);
	}

	function isPc98BoxDrawing(cp932code) {
		return (0x86a2 <= cp932code && cp932code <= 0x86ed);
	}
}
