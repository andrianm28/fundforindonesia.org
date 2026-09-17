import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { calculateZakat } from '@/lib/utils/zakat';

const DEFAULT_NISAB = 85 * 1_000_000; // 85 gram emas ~Rp85.000.000

const calculateSchema = z.object({
  assets: z.number().nonnegative('Total aset harus bernilai positif atau nol'),
  debts: z.number().nonnegative('Hutang harus bernilai positif atau nol').optional().default(0),
  nisab: z.number().positive('Nisab harus bernilai positif').optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = calculateSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: 'Validasi gagal', fieldErrors },
        { status: 400 }
      );
    }

    const { assets, debts, nisab } = result.data;
    const nisabThreshold = nisab ?? DEFAULT_NISAB;
    const netAssets = assets - debts;
    const isAboveNisab = netAssets > nisabThreshold;
    const zakatAmount = calculateZakat(netAssets, nisabThreshold);

    return NextResponse.json({
      zakatAmount,
      netAssets,
      isAboveNisab,
      nisabThreshold,
    });
  } catch (error) {
    console.error('Error calculating zakat:', error);
    return NextResponse.json(
      { error: 'Gagal menghitung zakat' },
      { status: 500 }
    );
  }
}
