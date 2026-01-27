import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

// Dev-only check middleware wrapper or check inside handler
const isDev = process.env.NODE_ENV !== 'production';

const updatesDir = path.join(process.cwd(), 'contents/updates');

export async function GET(req: Request) {
  if (!isDev) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get('slug');

    if (slug) {
      const filePath = path.join(updatesDir, `${slug}.mdx`);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return NextResponse.json({ content });
      } catch {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
    }

    await fs.mkdir(updatesDir, { recursive: true });
    const files = await fs.readdir(updatesDir);

    // Return list of MDX files
    const updates = files
      .filter(f => f.endsWith('.mdx'))
      .map(f => ({
        slug: f.replace('.mdx', ''),
        filename: f
      }));

    return NextResponse.json(updates);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to list updates' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isDev) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }

  try {
    const { slug, content, originalSlug } = await req.json();

    if (!slug || !content) {
      return NextResponse.json({ error: 'Missing slug or content' }, { status: 400 });
    }

    await fs.mkdir(updatesDir, { recursive: true });

    // If renaming
    if (originalSlug && originalSlug !== slug) {
      const oldPath = path.join(updatesDir, `${originalSlug}.mdx`);
      try {
        await fs.unlink(oldPath);
      } catch { }
    }

    const filePath = path.join(updatesDir, `${slug}.mdx`);
    await fs.writeFile(filePath, content, 'utf-8');

    return NextResponse.json({ success: true, slug });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save update' }, { status: 500 });
  }
}
