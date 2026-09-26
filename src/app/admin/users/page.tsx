"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { Assignment } from "@/generated/prisma/client";

// Assignments are the only thing that grants power (ADR 0005): this page
// shows and edits them, and nothing else about a user's authority.

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

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

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

  useEffect(() => {
    if (status === "authenticated") {
      fetchUsers(pagination.page, search);
    }
  }, [status, pagination.page, search, fetchUsers]);

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

  // Grants or revokes one assignment. The assignments route records the
  // change in the audit trail and refuses revoking your own ADMIN assignment
  // or the last one anywhere; the box only changes once it has agreed.
  const handleAssignmentChange = async (userId: string, assignment: Assignment, grant: boolean) => {
    setUpdatingUserId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/assignments`, {
        method: grant ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Gagal mengubah penugasan");
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

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Cari berdasarkan nama atau email..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                    currentUserId={session?.user?.id}
                    isUpdating={updatingUserId === user.id}
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
  onAssignmentChange,
}: {
  user: User;
  currentUserId: string | undefined;
  isUpdating: boolean;
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
            // The route refuses an Admin revoking their own ADMIN assignment.
            const locked = isSelf && value === "ADMIN" && held;
            return (
              <label key={value} className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={held}
                  disabled={isUpdating || locked}
                  onChange={(e) => onAssignmentChange(user.id, value, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                />
                {label}
              </label>
            );
          })}
        </div>
      </td>
    </tr>
  );
}
