import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createReader } from "@keystatic/core/reader";
import config from "../keystatic.config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

function normalizePost({ slug, entry }) {
    return {
        slug,
        title: entry.title,
        summary: entry.summary,
        date: entry.date,
        readingTime: entry.readingTime || undefined,
        topics: Array.isArray(entry.topics) ? entry.topics : [],
        category: entry.category || undefined,
    };
}

async function main() {
    const reader = createReader(repoRoot, config);
    const posts = await reader.collections.posts.all();
    const normalized = posts
        .map(normalizePost)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const outputPath = path.join(repoRoot, "blog", "posts.json");
    await fs.writeFile(outputPath, JSON.stringify(normalized, null, 4) + "\n", "utf-8");
    console.log(`Updated ${outputPath} with ${normalized.length} posts from Keystatic content.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
