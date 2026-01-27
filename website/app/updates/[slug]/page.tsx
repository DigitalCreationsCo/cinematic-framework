import { notFound } from 'next/navigation';
import { getUpdate, getAllUpdates } from '@/lib/updates';
import { Typography } from '@/components/ui/typography';
import { Separator } from '@/components/ui/separator';
import { Link } from '@/lib/transition';
import { buttonVariants } from '@/components/ui/button';
import { UpdatesSidebar } from '@/components/sidebar/updates-sidebar';
import { TableOfContents } from '@/components/toc';
import Image from 'next/image';
import { FaGithub, FaLinkedin, FaTwitter, FaEnvelope } from 'react-icons/fa';

interface PageProps {
  params: Promise<{ slug: string; }>;
}

export default async function UpdatePage({ params }: PageProps) {
  const { slug } = await params;
  const update = await getUpdate(slug);

  if (!update) notFound();

  const { frontmatter, content, tocs } = update;
  const pathName = `/updates/${slug}`;

  return (
    <div className="flex items-start gap-10 pt-10">
      <UpdatesSidebar />
      <div className="flex-1 mx-auto max-w-3xl">
        <Link href="/updates" className={ buttonVariants({ variant: "ghost", className: "mb-4" }) }>
          ← Back to Updates
        </Link>

        { frontmatter.coverImage && (
          <div className="relative w-full aspect-video mb-8 overflow-hidden rounded-xl border border-border">
            <Image
              src={ frontmatter.coverImage }
              alt={ frontmatter.title }
              fill
              className="object-cover"
              priority
            />
          </div>
        ) }

        <div className="mb-6">
          <h1 className="text-4xl font-bold mb-4">{ frontmatter.title }</h1>
          <div className="flex flex-wrap gap-6 items-center">
            <div className="text-sm text-muted-foreground">
              { new Date(frontmatter.date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              }) }
            </div>

            <div className="flex -space-x-2">
              { update.authors.map((author, i) => (
                <div key={ i } className="relative w-8 h-8 rounded-full border-2 border-background overflow-hidden bg-muted">
                  { author.image_url ? (
                    <Image src={ author.image_url } alt={ author.name } fill className="object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">
                      { author.name.charAt(0) }
                    </div>
                  ) }
                </div>
              )) }
            </div>
          </div>
        </div>

        { update.authors.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            { update.authors.map((author, i) => (
              <div key={ i } className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50">
                <div className="relative w-12 h-12 rounded-full overflow-hidden bg-muted flex-shrink-0">
                  { author.image_url && <Image src={ author.image_url } alt={ author.name } fill className="object-cover" /> }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{ author.name }</div>
                  { author.title && <div className="text-xs text-muted-foreground truncate">{ author.title }</div> }
                  <div className="flex gap-2 mt-1">
                    { author.socials?.github && (
                      <a href={ `https://github.com/${author.socials.github}` } target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                        <FaGithub size={ 14 } />
                      </a>
                    ) }
                    { author.socials?.linkedin && (
                      <a href={ `https://linkedin.com/in/${author.socials.linkedin}` } target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                        <FaLinkedin size={ 14 } />
                      </a>
                    ) }
                    { author.socials?.x && (
                      <a href={ `https://twitter.com/${author.socials.x}` } target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                        <FaTwitter size={ 14 } />
                      </a>
                    ) }
                    { author.socials?.newsletter && (
                      <a href={ author.socials.newsletter } target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                        <FaEnvelope size={ 14 } />
                      </a>
                    ) }
                  </div>
                </div>
              </div>
            )) }
          </div>
        ) }

        <Separator className="my-6" />

        <Typography>
          <section>{ content }</section>
        </Typography>
      </div>
      <TableOfContents tocs={ { tocs } } pathName={ pathName } frontmatter={ frontmatter } />
    </div>
  );
}

export async function generateStaticParams() {
  const updates = await getAllUpdates();
  return updates.map((update) => ({
    slug: update.slug,
  }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const update = await getUpdate(slug);
  if (!update) return null;
  return {
    title: update.frontmatter.title,
    description: update.frontmatter.description,
  };
}
