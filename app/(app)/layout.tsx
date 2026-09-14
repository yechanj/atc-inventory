import { Nav } from "@/components/Nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 sm:py-6">{children}</main>
    </div>
  );
}
