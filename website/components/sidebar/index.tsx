import { LuAlignLeft } from 'react-icons/lu'
import { Logo } from '#w/components/navigation/logo.js';
import { NavMenu } from '#w/components/navigation/navbar.js';
import { PageMenu } from '#w/components/sidebar/pagemenu.js';
import { Button } from '#w/components/ui/button.js';
import { DialogTitle } from '#w/components/ui/dialog.js';
import { ScrollArea } from '#w/components/ui/scroll-area.js';
import { Separator } from '#w/components/ui/separator.js';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTrigger } from '#w/components/ui/sheet.js'

export function Sidebar() {
  return (
    <aside
      className="sticky top-26 hidden h-screen min-w-57.5 flex-1 flex-col overflow-y-auto md:flex"
      aria-label="Page navigation"
    >
      <ScrollArea>
        <PageMenu />
      </ScrollArea>
    </aside>
  )
}

export function SheetLeft() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="flex cursor-pointer md:hidden">
          <LuAlignLeft className="size-6!" />
        </Button>
      </SheetTrigger>
      <SheetContent className="flex h-full flex-col gap-0 px-0" side="left">
        <DialogTitle className="sr-only">Menu</DialogTitle>
        <SheetHeader>
          <SheetClose asChild>
            <Logo />
          </SheetClose>
        </SheetHeader>
        <ScrollArea className="flex h-full flex-col overflow-y-auto">
          <div className="mx-0 mt-3 flex flex-col gap-2.5 px-5">
            <NavMenu isSheet />
            <Separator className="my-2" />
            <PageMenu isSheet />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
