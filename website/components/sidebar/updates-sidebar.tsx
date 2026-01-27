import { Link } from '@/lib/transition';
import { getAllUpdates } from '@/lib/updates';
import { ScrollArea } from '@/components/ui/scroll-area';

export async function UpdatesSidebar() {
    const updates = await getAllUpdates();

    return (
        <aside
            className="sticky top-26 hidden h-screen max-w-xl flex-col overflow-y-auto md:flex"
            aria-label="Updates navigation"
        >
            <ScrollArea>
                <div className="flex flex-col gap-3 p-4">
                    <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                        Latest updates and features
                    </h3>
                    <nav className="flex flex-col gap-2">
                        { updates.map((update) => (
                            <Link
                                key={ update.slug }
                                href={ `/updates/${update.slug}` }
                                className="text-sm hover:underline"
                            >
                                <div className="font-medium">{ update.frontmatter.title }</div>
                                <div className="text-xs text-muted-foreground">
                                    { new Date(update.frontmatter.date).toLocaleDateString(undefined, {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric'
                                    }) }
                                </div>
                            </Link>
                        )) }
                    </nav>
                </div>
            </ScrollArea>
        </aside>
    );
}
