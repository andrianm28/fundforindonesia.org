import Link from 'next/link';
import { AdminProgramForm } from '@/components/admin/AdminProgramForm';

/** Program baru: the create form (ticket 78). The Admin gate is the /admin layout's. */
export default function AdminNewProgramPage() {
  return (
    <div>
      <div className="mb-8">
        <Link href="/admin/programs" className="text-sm text-primary">
          &larr; Daftar Program
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Program baru</h1>
      </div>
      <AdminProgramForm />
    </div>
  );
}
