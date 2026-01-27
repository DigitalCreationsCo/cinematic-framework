import { Link } from '@/lib/transition';
import { getAllUpdates } from '@/lib/updates';
import { Typography } from '@/components/ui/typography';
import { Separator } from '@/components/ui/separator';
import { UpdatesSidebar } from '@/components/sidebar/updates-sidebar';
import { buttonVariants } from '@/components/ui/button';
import Image from 'next/image';

export const metadata = {
    title: 'Updates',
    description: 'Latest news and updates.',
};

export default async function UpdatesPage() {
    const updates = await getAllUpdates();

    return (
        <div className="container py-10 flex flex-row w-full">
            <UpdatesSidebar />

            <div className="space-y-12 p-[2rem] mx-auto flex flex-1 flex-col">
                { updates.length === 0 ? (
                    <p className="text-center">No updates found.</p>
                ) : (
                    updates.map((update) => (
                        <div key={ update.slug } className="w-full">
                            <div className="flex flex-col md:flex-row gap-8 items-start">
                                { update.frontmatter.coverImage && (
                                    <Link href={ `/updates/${update.slug}` } className="w-full md:w-1/3 aspect-video relative overflow-hidden rounded-lg border border-border flex-shrink-0 group">
                                        <Image
                                            src={ update.frontmatter.coverImage }
                                            alt={ update.frontmatter.title }
                                            fill
                                            className="object-cover transition-transform duration-500 group-hover:scale-110"
                                        />
                                    </Link>
                                ) }
                                <div className="flex flex-1 flex-col gap-3">
                                    <Link href={ `/updates/${update.slug}` } className="group">
                                        <h2 className="text-2xl font-bold group-hover:underline">{ update.frontmatter.title }</h2>
                                    </Link>
                                    <div className="text-xs text-muted-foreground flex items-center gap-3">
                                        { new Date(update.frontmatter.date).toLocaleDateString('en-US', {
                                            year: 'numeric',
                                            month: 'short',
                                            day: 'numeric'
                                        }) }
                                        { update.authors.length > 0 && (
                                            <>
                                                <span>•</span>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex -space-x-2">
                                                        { update.authors.map((author, i) => (
                                                            <div key={ i } className="relative w-5 h-5 rounded-full border border-background overflow-hidden bg-muted">
                                                                { author.image_url && <Image src={ author.image_url } alt={ author.name } fill className="object-cover" /> }
                                                            </div>
                                                        )) }
                                                    </div>
                                                    <span>{ update.authors.map(a => a.name).join(', ') }</span>
                                                </div>
                                            </>
                                        ) }
                                    </div>
                                    <div className="typography prose-sm text-muted-foreground line-clamp-3">
                                        { update.summary }
                                    </div>
                                    <Link
                                        href={ `/updates/${update.slug}` }
                                        className="text-sm font-medium hover:underline text-primary w-fit mt-1"
                                    >
                                        Read Full Update →
                                    </Link>
                                </div>
                            </div>
                            <Separator className="mt-12" />
                        </div>
                    ))) }
            </div >
        </div>
    );
}
