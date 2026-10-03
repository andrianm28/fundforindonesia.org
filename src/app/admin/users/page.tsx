"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { Assignment } from "@/generated/prisma/client";

// Assignments are the only thing that grants power (ADR 0005): this page
// shows and edits them, and nothing else about a user's authority.
//
// Granting ADMIN takes two Admins (ticket 07/20; CONTEXT.md, Admin): one
// proposes, a DIFFERENT Admin confirms. Checking the Admin box does not
// grant it outright -- it opens a pending request (POST .../assignments
// answers 202, not 201) and the box stays unchecked until someone else
// confirms it from the queue below. Granting VERIFIER stays a single
// Admin's immediate grant.

const ASSIGNMENTS: { value: Assignment; label: string }[] = [
  { value: "VERIFIER", label: "Verifier" },
  { value: "ADMIN", label: "Admin" },
];

interface User {
  id: string;
  name: string | null;
  email: string;
  createdAt: string;
  assignments: Assignment[];
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface PendingGrantRequest {
  id: string;
  userId: string;
  userName: string | null;
  proposedById: string;
  proposedByName: string | null;
  proposedAt: string;
  proposedReason: string | null;
}

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const currentUserId = session?.user?.id;

  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [pendingUserIds, setPendingUserIds] = useState<Set<string>>(new Set());
  const [pendingRequests, setPendingRequests] = useState<PendingGrantRequest[]>([]);
  const [decidingRequestId, setDecidingRequestId] = useState<string | null>(null);

  const fetchUsers = useCallback(async (page: number, searchQuery: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "10",
      });
      if (searchQuery) {
        params.set("search", searchQuery);
      }

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Gagal memuat data pengguna");
      }

      const data = await res.json();
      setUsers(data.users);
      setPagination(data.pagination);
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // The queue of pending ADMIN grants, so a different Admin can see what is
  // waiting for them to confirm.
  const fetchPendingRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/assignment-grant-requests");
      if (!res.ok) return;
      const data = await res.json();
      setPendingRequests(data.requests ?? []);
      setPendingUserIds(new Set((data.requests ?? []).map((r: PendingGrantRequest) => r.userId)));
    } catch (error) {
      console.error("Error fetching pending grant requests:", error);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetchUsers(pagination.page, search);
      fetchPendingRequests();
    }
  }, [status, pagination.page, search, fetchUsers, fetchPendingRequests]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  // Grants or revokes one assignment. Granting VERIFIER and revoking either
  // assignment are immediate: the assignments route records the change in
  // the audit trail and refuses revoking your own assignment, of either
  // kind, or the last ADMIN anywhere. Granting ADMIN is not immediate: the
  // route answers 202 with a PENDING request instead, and the box stays
  // unchecked until a different Admin confirms it below.
  const handleAssignmentChange = async (userId: string, assignment: Assignment, grant: boolean) => {
    setUpdatingUserId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/assignments`, {
        method: grant ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert(data.error || "Gagal mengubah penugasan");
        return;
      }

      if (grant && assignment === "ADMIN" && data.action === "PROPOSED") {
        await fetchPendingRequests();
        return;
      }

      setUsers((prev) =>
        prev.map((user) =>
          user.id !== userId
            ? user
            : {
                ...user,
                assignments: grant
                  ? [...user.assignments.filter((a) => a !== assignment), assignment]
                  : user.assignments.filter((a) => a !== assignment),
              }
        )
      );
    } catch (error) {
      console.error("Error updating assignment:", error);
      alert("Gagal mengubah penugasan pengguna");
    } finally {
      setUpdatingUserId(null);
    }
  };

  // The second Admin's half of a pending grant: confirm it (granting ADMIN)
  // or, for the Admin who proposed it, withdraw it.
  const handleGrantDecision = async (requestId: string, decision: "confirm" | "withdraw") => {
    setDecidingRequestId(requestId);
    try {
      const res = await fetch(`/api/admin/assignment-grant-requests/${requestId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert(data.error || "Gagal memproses pengajuan");
        return;
      }

      if (decision === "confirm") {
        setUsers((prev) =>
          prev.map((user) =>
            user.id !== data.userId ? user : { ...user, assignments: [...user.assignments, "ADMIN" as Assignment] }
          )
        );
      }
      await fetchPendingRequests();
    } catch (error) {
      console.error("Error deciding grant request:", error);
      alert("Gagal memproses pengajuan");
    } finally {
      setDecidingRequestId(null);
    }
  };

  const goToPage = (page: number) => {
    setPagination((prev) => ({ ...prev, page }));
  };

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Manajemen Pengguna</h1>
        <p className="text-gray-600 mt-1">
          Kelola penugasan Verifier dan Admin pengguna di platform
        </p>
      </div>

      {pendingRequests.length > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-6 py-3 border-b border-amber-200">
            <h2 className="text-sm font-semibold text-amber-900">
              Menunggu konfirmasi grant ADMIN
            </h2>
            <p className="text-xs text-amber-700 mt-0.5">
              Grant ADMIN membutuhkan Admin lain yang bukan pengaju maupun penerimanya.
            </p>
          </div>
          <ul className="divide-y divide-amber-100">
            {pendingRequests.map((request) => {
              const isProposer = request.proposedById === currentUserId;
              const isGrantee = request.userId === currentUserId;
              const deciding = decidingRequestId === request.id;
              return (
                <li key={request.id} className="px-6 py-3 flex items-center justify-between text-sm">
                  <span className="text-gray-700">
                    <strong>{request.userName || request.userId}</strong> diajukan oleh{" "}
                    {request.proposedByName || request.proposedById}
                  </span>
                  <div className="flex gap-2">
                    {isProposer && (
                      <button
                        type="button"
                        disabled={deciding}
                        onClick={() => handleGrantDecision(request.id, "withdraw")}
                        className="px-3 py-1 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                      >
                        Tarik
                      </button>
                    )}
                    {!isProposer && !isGrantee && (
                      <button
                        type="button"
                        disabled={deciding}
                        onClick={() => handleGrantDecision(request.id, "confirm")}
                        className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        Konfirmasi
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Cari berdasarkan nama atau email..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Cari
          </button>
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setSearchInput("");
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
              className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-300 transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </form>

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-3 font-medium text-gray-600">
                  Nama
                </th>
                <th className="text-left px-6 py-3 font-medium text-gray-600">
                  Email
                </th>
                <th className="text-left px-6 py-3 font-medium text-gray-600">
                  Tanggal Daftar
                </th>
                <th className="text-left px-6 py-3 font-medium text-gray-600">
                  Penugasan
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-10 text-center text-gray-500"
                  >
                    {search
                      ? "Tidak ada pengguna yang cocok dengan pencarian."
                      : "Belum ada pengguna."}
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    currentUserId={currentUserId}
                    isUpdating={updatingUserId === user.id}
                    isAdminGrantPending={pendingUserIds.has(user.id)}
                    onAssignmentChange={handleAssignmentChange}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Menampilkan {(pagination.page - 1) * pagination.limit + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} dari{" "}
            {pagination.total} pengguna
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => goToPage(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Sebelumnya
            </button>
            <span className="px-3 py-1.5 text-sm text-gray-700">
              Halaman {pagination.page} dari {pagination.totalPages}
            </span>
            <button
              onClick={() => goToPage(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Berikutnya
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserRow({
  user,
  currentUserId,
  isUpdating,
  isAdminGrantPending,
  onAssignmentChange,
}: {
  user: User;
  currentUserId: string | undefined;
  isUpdating: boolean;
  isAdminGrantPending: boolean;
  onAssignmentChange: (userId: string, assignment: Assignment, grant: boolean) => void;
}) {
  const isSelf = user.id === currentUserId;

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-6 py-4 font-medium text-gray-900">
        {user.name || "—"}
      </td>
      <td className="px-6 py-4 text-gray-600">{user.email}</td>
      <td className="px-6 py-4 text-gray-600">
        {new Date(user.createdAt).toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </td>
      <td className="px-6 py-4">
        <div className="flex gap-4">
          {ASSIGNMENTS.map(({ value, label }) => {
            const held = user.assignments.includes(value);
            // Nobody may revoke their own assignment, of either kind
            // (ticket 07/20 decision): the route refuses it, and the box
            // only disables the case that would be a revoke -- one already
            // held by the person looking at their own row.
            const locked = isSelf && held;
            // A pending ADMIN grant for this user: the box stays unchecked
            // and disabled until a different Admin confirms it below.
            const pending = value === "ADMIN" && !held && isAdminGrantPending;
            return (
              <span key={value} className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={held}
                    disabled={isUpdating || locked || pending}
                    onChange={(e) => onAssignmentChange(user.id, value, e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  />
                  {label}
                </label>
                {pending && <span className="text-xs text-amber-600">(menunggu konfirmasi)</span>}
              </span>
            );
          })}
        </div>
      </td>
    </tr>
  );
}
