import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import Image from "next/image";
import { UserRound, CalendarDays } from "lucide-react";
import { getDb } from "@/src/db";
import { users } from "@/src/db/schema";
import { ownerListings } from "@/src/services/search-service";
import { Card } from "@/src/components/ui/card";
import { ItemCard } from "@/src/components/item-card";
import { VerificationChip } from "@/src/components/ui/status-chip";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [user] = await getDb()
    .select({
      name: users.name,
      avatarUrl: users.avatarUrl,
      verificationStatus: users.verificationStatus,
      ratingAvg: users.ratingAvg,
      ratingCount: users.ratingCount,
      completedCount: users.completedCount,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.id, id), eq(users.accountStatus, "aktif")));
  if (!user) notFound();
  const listings = await ownerListings(getDb(), id);
  return (
    <div className="page-container max-w-4xl py-12">
      <Card className="mx-auto max-w-2xl text-center">
        {user.avatarUrl ? (
          <Image
            unoptimized
            src={user.avatarUrl}
            alt={`Foto ${user.name}`}
            width={96}
            height={96}
            className="mx-auto mb-5 size-24 rounded-full object-cover"
          />
        ) : (
          <span className="mx-auto mb-5 flex size-24 items-center justify-center rounded-full bg-secondary text-primary">
            <UserRound size={40} />
          </span>
        )}
        <h1 className="mb-4 text-2xl">{user.name || "Teman SewaMates"}</h1>
        <VerificationChip status={user.verificationStatus} />
        <p className="mt-5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <CalendarDays size={16} />
          Bergabung{" "}
          {new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(
            user.createdAt,
          )}
        </p>
        <div className="mt-7 grid grid-cols-2 gap-4 border-t border-border pt-7">
          <div>
            <p className="text-2xl font-extrabold">
              {user.ratingCount ? (user.ratingAvg / 100).toFixed(1) : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{user.ratingCount} ulasan</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold">{user.completedCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">Transaksi selesai</p>
          </div>
        </div>
      </Card>
      {listings.length > 0 && (
        <section className="mt-10" aria-labelledby="owner-listings">
          <h2 id="owner-listings" className="mb-4 text-xl">
            Barang yang disewakan
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {listings.map((item) => (
              <li key={item.id} className="flex min-w-0">
                <ItemCard item={item} className="w-full" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
