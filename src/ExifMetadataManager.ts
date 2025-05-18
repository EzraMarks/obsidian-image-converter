import { App, TFile } from "obsidian";
import piexif from "piexifjs";

export class ExifMetadataManager {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

	/**
	 * Helper to extract EXIF date and original filename from a TFile.
	 * @param file - The TFile to extract from.
	 * @returns An object: { dateTaken: string, originalFileName: string }
	 */
	async extractExifDateAndFilename(file: TFile): Promise<{ dateTaken: string, originalFileName: string }> {
		let dateTaken = '';
		let originalFileName = '';
		try {
			const arrayBuffer = await this.app.vault.readBinary(file);
			const headerBytes = 64 * 1024; // 64KB should be enough for EXIF data
			const slicedBuffer = arrayBuffer.byteLength > headerBytes ? arrayBuffer.slice(0, headerBytes) : arrayBuffer;
			const binary = String.fromCharCode(...new Uint8Array(slicedBuffer));
			const base64 = window.btoa(binary);
			const dataUrl = `data:image/jpeg;base64,${base64}`;
			const exifObj = piexif.load(dataUrl);
			const exifDate = exifObj?.Exif?.[piexif.ExifIFD.DateTimeOriginal];
			if (exifDate) dateTaken = exifDate.split(' ')[0]?.replace(/:/g, '-');

			// Try to extract the original file name from UserComment
			const userCommentTag = piexif.ExifIFD.UserComment;
			const userComment = exifObj?.Exif?.[userCommentTag];
			let commentText = "";
			if (typeof userComment === "string" && userComment.startsWith("ASCII\0\0\0")) {
				commentText = userComment.substring(8);
			} else if (typeof userComment === "string") {
				commentText = userComment;
			}
			const match = commentText.match(/^OriginalFilename:\s*(.+)$/m);
			if (match) {
				originalFileName = match[1].trim();
			}
		} catch (exifErr) {
			console.warn('Could not extract EXIF date or original filename:', exifErr);
		}
		return { dateTaken, originalFileName };
	}

    /**
     * Adds metadata to the file to encode the original filename, if it was not already encoded.
     * Metadata is added to the UserComment field of the EXIF data on a new line,
     * e.g. "OriginalFilename: myfile.jpg".
     */
    static async encodeOriginalFilename(fileName: string, metadata: piexif.ExifDict): Promise<void> {
        // If the file does not have its original datetime, we assume it is missing all of its original metadata;
        // therefore encoding its current filename would not be useful, because the filename has likely already changed from its original.
        const hasOriginalMetadata = metadata?.Exif?.[piexif.ExifIFD.DateTimeOriginal];
        if (!hasOriginalMetadata || !fileName) return;

        // piexif.ExifIFD.UserComment is the tag for UserComment (37510)
        const userCommentTag = piexif.ExifIFD.UserComment;
        const exif = metadata?.["Exif"] ?? {};

        // Get existing UserComment (may be undefined)
        const existingComment = exif[userCommentTag];

        // Decode UserComment if it exists and starts with ASCII prefix
        let commentText = "";
        if (typeof existingComment === "string" && existingComment.startsWith("ASCII\0\0\0")) {
            commentText = existingComment.substring(8); // Remove prefix
        } else if (typeof existingComment === "string") {
            commentText = existingComment;
        }

        // Check if any line starts with "OriginalFilename"
        const hasOriginalFilename = commentText
            .split(/\r?\n/)
            .some(line => line.trim().startsWith("OriginalFilename"));

        if (!hasOriginalFilename) {
            // Add new line with "OriginalFilename: filename"
            commentText = commentText
                ? commentText + "\nOriginalFilename: " + fileName
                : "OriginalFilename: " + fileName;
            // Per EXIF spec, UserComment should start with a charset prefix (here: ASCII)
            const prefix = "ASCII\0\0\0";
            exif[userCommentTag] = prefix + commentText;
            metadata["Exif"] = exif;
        }
    }
}
