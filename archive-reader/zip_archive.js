import {
	makeArchiveError, normalizeOptions, createByteSource,
	readUint16, readUint32, readUint64, convertDosTimestamp, decodeUtf8, splitPath, computeCrc32,
} from './archive_common.js';

const endOfCentralDirectorySignature = 0x06054b50;
const zip64LocatorSignature = 0x07064b50;
const zip64EndOfCentralDirectorySignature = 0x06064b50;
const centralDirectoryEntrySignature = 0x02014b50;
const localHeaderSignature = 0x04034b50;

const endOfCentralDirectorySize = 22;
const maxCommentSize = 0xffff;
const zip64LocatorSize = 20;
const localHeaderSize = 30;
const localHeaderMaxSize = localHeaderSize + 0xffff + 0xffff;

const methodNames = {
	0:  'stored',
	1:  'shrink',
	2:  'reduce1',
	3:  'reduce2',
	4:  'reduce3',
	5:  'reduce4',
	6:  'implode',
	8:  'deflate',
	9:  'deflate64',
	12: 'bzip2',
	14: 'lzma',
	98: 'ppmd',
};

export function isZipArchive(bytes) {
	console.assert(bytes instanceof Uint8Array);

	if (bytes.length < 4) {
		return false;
	}

	const signature = readUint32(bytes, 0);
	return (signature === localHeaderSignature || signature === endOfCentralDirectorySignature);
}

// Finds the central directory from the tail of the source. Returns null if the source has no End of Central Directory record.
export async function locateZipCentralDirectory(byteSource) {
	const tailLength = Math.min(byteSource.size, endOfCentralDirectorySize + maxCommentSize + zip64LocatorSize);
	const tailOffset = byteSource.size - tailLength;
	const tailBytes = await byteSource.read(tailOffset, tailLength);

	const eocdOffset = findEndOfCentralDirectory(tailBytes);
	if (eocdOffset < 0) {
		return null;
	}

	let directory = parseEndOfCentralDirectory(tailBytes, eocdOffset);
	let directoryEnd = tailOffset + eocdOffset;

	// A zip64 archive has a locator just before the record, which points to the zip64 record.
	const zip64Offset = parseZip64Locator(tailBytes, eocdOffset - zip64LocatorSize);
	if (zip64Offset >= 0 && zip64Offset < byteSource.size) {
		directory = parseZip64EndOfCentralDirectory(await byteSource.read(zip64Offset, 56));
		directoryEnd = zip64Offset;
	}

	// If a stub (self-extractor) is put before the archive, the offsets are shifted by its size.
	const shift = directoryEnd - (directory.centralDirectoryOffset + directory.centralDirectorySize);
	return {...directory, shift: (shift > 0) ? shift : 0};

	// Finds the End of Central Directory record in the tail bytes. Returns its offset in the bytes, or -1.
	function findEndOfCentralDirectory(tailBytes) {
		console.assert(tailBytes instanceof Uint8Array);

		// The record ends with a comment of variable length, so it is searched backward.
		for (let offset = tailBytes.length - endOfCentralDirectorySize; offset >= 0; offset--) {
			if (readUint32(tailBytes, offset) === endOfCentralDirectorySignature) {
				const commentLength = readUint16(tailBytes, offset + 20);
				if (offset + endOfCentralDirectorySize + commentLength <= tailBytes.length) {
					return offset;
				}
			}
		}

		return -1;
	}

	function parseEndOfCentralDirectory(bytes, offset) {
		console.assert(readUint32(bytes, offset) === endOfCentralDirectorySignature);

		return {
			entryCount:             readUint16(bytes, offset + 10),
			centralDirectorySize:   readUint32(bytes, offset + 12),
			centralDirectoryOffset: readUint32(bytes, offset + 16),
		};
	}

	// Returns the offset of the zip64 End of Central Directory record from the locator, or -1 if there is no locator.
	function parseZip64Locator(bytes, offset) {
		if (offset < 0 || offset + zip64LocatorSize > bytes.length || readUint32(bytes, offset) !== zip64LocatorSignature) {
			return -1;
		}
		return readUint64(bytes, offset + 8);
	}

	function parseZip64EndOfCentralDirectory(bytes) {
		if (bytes.length < 56 || readUint32(bytes, 0) !== zip64EndOfCentralDirectorySignature) {
			throw makeArchiveError('Invalid zip64 End of Central Directory record');
		}

		return {
			entryCount:             readUint64(bytes, 32),
			centralDirectorySize:   readUint64(bytes, 40),
			centralDirectoryOffset: readUint64(bytes, 48),
		};
	}
}

export async function openZipArchive(source, options = {}) {
	const byteSource = createByteSource(source);
	const {isUtf8NameGuessed, decodeFileName, isCrcVerified} = normalizeOptions(options);

	const directory = await locateZipCentralDirectory(byteSource);
	if (!directory) {
		throw makeArchiveError('Not a zip archive');
	}

	// Tries the offset as written first, then the shifted one.
	let directoryOffset = directory.centralDirectoryOffset;
	let directoryBytes = await byteSource.read(directoryOffset, directory.centralDirectorySize);
	let shift = 0;
	if (!isCentralDirectoryEntry(directoryBytes, 0) && directory.shift > 0) {
		shift = directory.shift;
		directoryOffset += shift;
		directoryBytes = await byteSource.read(directoryOffset, directory.centralDirectorySize);
	}

	const records = [];
	let offset = 0;

	while (offset < directoryBytes.length && records.length < directory.entryCount) {
		const record = parseCentralDirectoryEntry(directoryBytes, offset);
		if (!record) {
			throw makeArchiveError('Invalid zip central directory');
		}
		records.push(record);
		offset += record.recordSize;
	}

	// Some archivers write UTF-8 names without the flag. It is guessed for the whole archive because a single name can be ambiguous.
	const decodeName = (isUtf8NameGuessed && isUtf8Guessed(records)) ? decodeUtf8 : decodeFileName;
	const entries = records.map((e, i) => makeEntry(e, i, directoryOffset + e.recordOffset, shift, decodeName));

	async function readEntry(entry) {
		if (entries[entry?.index] !== entry) {
			throw makeArchiveError('The entry does not belong to this archive');
		}
		if (entry.isDirectory) {
			return new Uint8Array(0);
		}
		if (entry.isEncrypted) {
			throw makeArchiveError('Encrypted zip entries are not supported');
		}
		if (entry.method !== 'stored' && entry.method !== 'deflate') {
			throw makeArchiveError(`Unsupported zip method: ${entry.method}`);
		}

		// The local header may have a different length of the name and the extra field from the central directory.
		const localHeaderBytes = await byteSource.read(entry.dataOffset, Math.min(localHeaderMaxSize, byteSource.size - entry.dataOffset));
		const dataOffset = entry.dataOffset + parseLocalHeaderSize(localHeaderBytes);

		const compressedBytes = await byteSource.read(dataOffset, entry.compressedSize);
		if (compressedBytes.length < entry.compressedSize) {
			throw makeArchiveError('Compressed data is truncated');
		}

		const bytes = (entry.method === 'stored') ? compressedBytes.slice() : await inflateRaw(compressedBytes);
		if (bytes.length !== entry.originalSize) {
			throw makeArchiveError('Decoded size does not match the header');
		}
		if (isCrcVerified && computeCrc32(bytes) !== entry.crc) {
			throw makeArchiveError('CRC mismatch');
		}
		return bytes;
	}

	return Object.freeze({
		format: 'zip',
		entries: Object.freeze(entries),
		readEntry,
	});

	function isCentralDirectoryEntry(bytes, offset) {
		return (offset + 46 <= bytes.length && readUint32(bytes, offset) === centralDirectoryEntrySignature);
	}

	// Parses one central directory entry at the offset. Returns null if the bytes do not have a valid entry there.
	function parseCentralDirectoryEntry(bytes, offset) {
		console.assert(bytes instanceof Uint8Array && Number.isInteger(offset));

		if (!isCentralDirectoryEntry(bytes, offset)) {
			return null;
		}

		const nameLength = readUint16(bytes, offset + 28);
		const extraLength = readUint16(bytes, offset + 30);
		const commentLength = readUint16(bytes, offset + 32);
		const recordSize = 46 + nameLength + extraLength + commentLength;
		if (offset + recordSize > bytes.length) {
			return null;
		}

		const entry = {
			recordOffset:       offset,
			recordSize,
			versionMadeBy:      readUint16(bytes, offset + 4),
			flags:              readUint16(bytes, offset + 8),
			methodNo:           readUint16(bytes, offset + 10),
			dosTime:            readUint16(bytes, offset + 12),
			dosDate:            readUint16(bytes, offset + 14),
			crc:                readUint32(bytes, offset + 16),
			compressedSize:     readUint32(bytes, offset + 20),
			originalSize:       readUint32(bytes, offset + 24),
			externalAttributes: readUint32(bytes, offset + 38),
			localHeaderOffset:  readUint32(bytes, offset + 42),
			rawName:            bytes.slice(offset + 46, offset + 46 + nameLength),
			extraFields:        parseExtraFields(bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength)),
		};

		// The zip64 extra field holds the values which do not fit in 32 bits, in this order and only those ones.
		const zip64Field = entry.extraFields.find((e) => (e.type === 0x0001));
		if (zip64Field) {
			let pos = 0;

			for (const key of ['originalSize', 'compressedSize', 'localHeaderOffset']) {
				if (entry[key] === 0xffffffff && pos + 8 <= zip64Field.bytes.length) {
					entry[key] = readUint64(zip64Field.bytes, pos);
					pos += 8;
				}
			}
		}

		entry.unicodePath = findUnicodePath(entry);

		return entry;

		function parseExtraFields(bytes) {
			const fields = [];
			let pos = 0;

			while (pos + 4 <= bytes.length) {
				const type = readUint16(bytes, pos);
				const size = readUint16(bytes, pos + 2);
				if (pos + 4 + size > bytes.length) {
					break;
				}
				fields.push({type, bytes: bytes.slice(pos + 4, pos + 4 + size)});
				pos += 4 + size;
			}

			return fields;
		}

		// Returns the name in the Info-ZIP Unicode Path extra field (0x7075), or null.
		// The field is used only if its CRC-32 matches the name field, because a tool may have changed the name field after it was written.
		function findUnicodePath(record) {
			const field = record.extraFields.find((e) => (e.type === 0x7075));
			if (!field || field.bytes.length < 5 || field.bytes[0] !== 1) {
				return null;
			}
			if (readUint32(field.bytes, 1) !== computeCrc32(record.rawName)) {
				return null;
			}

			return decodeUtf8(field.bytes.subarray(5));
		}
	}

	// Takes the names as UTF-8 only if every non-ASCII name without the flag is valid UTF-8 and some name has a 3 or 4 byte character.
	// The second condition is for Shift_JIS names of half-width katakana. Their byte pairs can be valid 2 byte UTF-8 characters.
	// The names already given by the Unicode Path extra field are left out.
	function isUtf8Guessed(records) {
		const flaglessRawNames = records.filter((e) => ((e.flags & 0x0800) === 0) && e.unicodePath === null).map((e) => e.rawName);
		const rawNames = flaglessRawNames.filter((e) => e.some((byte) => (byte >= 0x80)));
		if (rawNames.length === 0) {
			return false;
		}

		const decoder = new TextDecoder('utf-8', {fatal: true});
		const isAllValid = rawNames.every((e) => {
			try {
				decoder.decode(e);
				return true;
			} catch {
				return false;
			}
		});
		const hasLongCharacter = rawNames.some((e) => e.some((byte) => (0xe0 <= byte && byte <= 0xf4)));

		return (isAllValid && hasLongCharacter);
	}

	// Returns the size of the local header (which is the offset of the data from the header).
	function parseLocalHeaderSize(bytes) {
		console.assert(bytes instanceof Uint8Array);

		if (bytes.length < localHeaderSize || readUint32(bytes, 0) !== localHeaderSignature) {
			throw makeArchiveError('Invalid zip local header');
		}
		return localHeaderSize + readUint16(bytes, 26) + readUint16(bytes, 28);
	}
}

function makeEntry(record, index, headerOffset, shift, decodeFileName) {
	// Bit 11 of the flags and the Unicode Path extra field give a UTF-8 name. Otherwise the encoding depends on the archiver.
	const isUtf8 = ((record.flags & 0x0800) !== 0);
	let path;
	if (isUtf8) {
		path = decodeUtf8(record.rawName);
	} else if (record.unicodePath !== null) {
		path = record.unicodePath;
	} else {
		path = decodeFileName(record.rawName);
	}

	const {directory, name} = splitPath(path);
	const isDirectory = (path.endsWith('/'));

	return Object.freeze({
		index,
		directory,
		name,
		rawName:        record.rawName,
		isDirectory,
		method:         getZipMethodName(record.methodNo),
		compressedSize: record.compressedSize,
		originalSize:   record.originalSize,
		timestamp:      convertDosTimestamp(record.dosTime, record.dosDate),
		crc:            record.crc,
		attribute:      record.externalAttributes & 0xff,
		headerOffset,
		dataOffset:     record.localHeaderOffset + shift,
		versionMadeBy:  record.versionMadeBy,
		flags:          record.flags,
		isEncrypted:    ((record.flags & 0x0001) !== 0),
		extraFields:    Object.freeze(record.extraFields.map((e) => Object.freeze(e))),
	});

	function getZipMethodName(methodNo) {
		console.assert(Number.isInteger(methodNo));

		return methodNames[methodNo] ?? `method-${methodNo}`;
	}
}

async function inflateRaw(bytes) {
	if (typeof DecompressionStream === 'undefined') {
		throw makeArchiveError('DecompressionStream is not available');
	}

	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	try {
		return new Uint8Array(await new Response(stream).arrayBuffer());
	} catch (error) {
		throw makeArchiveError(`Broken compressed data: ${error.message}`);
	}
}
