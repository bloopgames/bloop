#!/usr/bin/env python3
"""
Reads YouTube live chat comments aloud using macOS `say` command.

Usage:
    python3 youtube_say.py VIDEO_ID

Where VIDEO_ID is the part after v= in your stream URL:
    https://www.youtube.com/watch?v=ABC123 -> VIDEO_ID is ABC123

Requires: pip install pytchat
"""

import subprocess
import sys
import time

import pytchat


def say(text: str, voice: str = "Samantha"):
    """Speak text using macOS say command."""
    # Sanitize text to avoid shell issues
    clean = text.replace('"', "").replace("'", "").replace("\n", " ")
    # Skip empty or very long messages
    if not clean.strip() or len(clean) > 200:
        return
    subprocess.run(["say", "-v", voice, clean])


def friendly_name(author: str) -> str:
    """Convert author names to TTS-friendly versions."""
    normalized = author.lower().strip().lstrip("@")
    if normalized in ("nu11", "null"):
        return "null"
    return author


def main():
    if len(sys.argv) < 2:
        print("Usage: python youtube_say.py VIDEO_ID")
        print("Example: python youtube_say.py dQw4w9WgXcQ")
        sys.exit(1)

    video_id = sys.argv[1]
    print(f"Connecting to live chat for video: {video_id}")

    chat = pytchat.create(video_id=video_id)
    print("Connected! Listening for comments...\n")

    while chat.is_alive():
        for c in chat.get().sync_items():
            author = c.author.name
            message = c.message
            print(f"{author}: {message}")
            say(f"{friendly_name(author)} says: {message}")

        time.sleep(0.5)  # Small delay to prevent hammering

    print("Chat ended or stream offline.")


if __name__ == "__main__":
    main()
