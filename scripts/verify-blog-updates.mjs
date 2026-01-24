tailwind.config.ts import { getAllUpdates } from '../website/lib/updates.js';

async function verify() {
  console.log('Verifying updates...');
  const updates = await getAllUpdates();
  console.log(`Found ${updates.length} updates:`);
  updates.forEach(u => {
    console.log(`- ${u.slug} (${u.frontmatter.date}): ${u.frontmatter.title}`);
  });
}

verify().catch(console.error);
