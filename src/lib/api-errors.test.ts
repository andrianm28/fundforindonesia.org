import { describe, it, expect } from 'vitest';
import {
  ApiError,
  validationError,
  notFoundError,
  unauthorizedError,
  forbiddenError,
  serverError,
  conflictError,
  apiErrorResponse,
  handlePrismaError,
} from './api-errors';

describe('validationError', () => {
  it('creates a validation error with message and field', () => {
    const error = validationError('Email tidak valid', 'email');
    expect(error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Email tidak valid',
      field: 'email',
      status: 400,
    });
  });

  it('creates a validation error without field', () => {
    const error = validationError('Data tidak lengkap');
    expect(error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Data tidak lengkap',
      field: undefined,
      status: 400,
    });
  });
});

describe('notFoundError', () => {
  it('creates a not found error with resource name', () => {
    const error = notFoundError('Kampanye');
    expect(error).toEqual({
      code: 'NOT_FOUND',
      message: 'Kampanye tidak ditemukan',
      status: 404,
    });
  });

  it('uses "Data" as default resource name', () => {
    const error = notFoundError();
    expect(error.message).toBe('Data tidak ditemukan');
    expect(error.status).toBe(404);
  });
});

describe('unauthorizedError', () => {
  it('creates an unauthorized error with Indonesian message', () => {
    const error = unauthorizedError();
    expect(error).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Anda harus login terlebih dahulu',
      status: 401,
    });
  });
});

describe('forbiddenError', () => {
  it('creates a forbidden error with default message', () => {
    const error = forbiddenError();
    expect(error).toEqual({
      code: 'FORBIDDEN',
      message: 'Anda tidak memiliki akses',
      status: 403,
    });
  });

  it('creates a forbidden error with custom message', () => {
    const error = forbiddenError('Hanya pembuat kampanye yang dapat mengedit');
    expect(error.message).toBe('Hanya pembuat kampanye yang dapat mengedit');
    expect(error.status).toBe(403);
  });
});

describe('serverError', () => {
  it('creates a server error with default message', () => {
    const error = serverError();
    expect(error).toEqual({
      code: 'SERVER_ERROR',
      message: 'Terjadi kesalahan pada server',
      status: 500,
    });
  });

  it('creates a server error with custom message', () => {
    const error = serverError('Gagal menghubungi layanan pembayaran');
    expect(error.message).toBe('Gagal menghubungi layanan pembayaran');
    expect(error.status).toBe(500);
  });
});

describe('conflictError', () => {
  it('creates a conflict error with default message', () => {
    const error = conflictError();
    expect(error).toEqual({
      code: 'CONFLICT',
      message: 'Data sudah ada',
      status: 409,
    });
  });

  it('creates a conflict error with custom message', () => {
    const error = conflictError('Email sudah terdaftar');
    expect(error.message).toBe('Email sudah terdaftar');
    expect(error.status).toBe(409);
  });
});

describe('apiErrorResponse', () => {
  it('creates a Response with correct status and JSON body', async () => {
    const error: ApiError = {
      code: 'NOT_FOUND',
      message: 'Kampanye tidak ditemukan',
      status: 404,
    };
    const response = apiErrorResponse(error);

    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('application/json');

    const body = await response.json();
    expect(body).toEqual({
      code: 'NOT_FOUND',
      message: 'Kampanye tidak ditemukan',
      status: 404,
    });
  });

  it('includes field in body when present', async () => {
    const error: ApiError = {
      code: 'VALIDATION_ERROR',
      message: 'Email tidak valid',
      field: 'email',
      status: 400,
    };
    const response = apiErrorResponse(error);
    const body = await response.json();

    expect(body.field).toBe('email');
  });

  it('includes details in body when present', async () => {
    const error: ApiError = {
      code: 'VALIDATION_ERROR',
      message: 'Data tidak valid',
      details: { fields: ['email', 'name'] },
      status: 400,
    };
    const response = apiErrorResponse(error);
    const body = await response.json();

    expect(body.details).toEqual({ fields: ['email', 'name'] });
  });

  it('excludes field and details from body when not present', async () => {
    const error: ApiError = {
      code: 'UNAUTHORIZED',
      message: 'Anda harus login terlebih dahulu',
      status: 401,
    };
    const response = apiErrorResponse(error);
    const body = await response.json();

    expect(body).not.toHaveProperty('field');
    expect(body).not.toHaveProperty('details');
  });
});

describe('handlePrismaError', () => {
  it('maps P2002 (unique constraint) to 409 conflict', () => {
    const prismaError = {
      code: 'P2002',
      meta: { target: ['email'] },
    };
    const error = handlePrismaError(prismaError);

    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Data sudah ada');
    expect(error.field).toBe('email');
    expect(error.status).toBe(409);
  });

  it('maps P2002 with multiple fields', () => {
    const prismaError = {
      code: 'P2002',
      meta: { target: ['provider', 'providerAccountId'] },
    };
    const error = handlePrismaError(prismaError);

    expect(error.field).toBe('provider, providerAccountId');
    expect(error.status).toBe(409);
  });

  it('maps P2025 (not found) to 404', () => {
    const prismaError = {
      code: 'P2025',
      meta: { modelName: 'Campaign' },
    };
    const error = handlePrismaError(prismaError);

    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Campaign tidak ditemukan');
    expect(error.status).toBe(404);
  });

  it('maps P2025 without modelName to generic message', () => {
    const prismaError = {
      code: 'P2025',
      meta: {},
    };
    const error = handlePrismaError(prismaError);

    expect(error.message).toBe('Data tidak ditemukan');
    expect(error.status).toBe(404);
  });

  it('maps P2003 (foreign key constraint) to 400 validation error', () => {
    const prismaError = {
      code: 'P2003',
      meta: { field_name: 'campaignId' },
    };
    const error = handlePrismaError(prismaError);

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Data referensi tidak valid');
    expect(error.field).toBe('campaignId');
    expect(error.status).toBe(400);
  });

  it('maps P2014 (relation violation) to 400 validation error', () => {
    const prismaError = {
      code: 'P2014',
      meta: {},
    };
    const error = handlePrismaError(prismaError);

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Relasi data tidak valid');
    expect(error.status).toBe(400);
  });

  it('maps unknown Prisma error codes to 500 server error', () => {
    const prismaError = {
      code: 'P9999',
      meta: {},
    };
    const error = handlePrismaError(prismaError);

    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toBe('Terjadi kesalahan pada server');
    expect(error.status).toBe(500);
  });

  it('handles non-Prisma errors gracefully', () => {
    const genericError = new Error('Something went wrong');
    const error = handlePrismaError(genericError);

    expect(error.code).toBe('SERVER_ERROR');
    expect(error.status).toBe(500);
  });

  it('handles null/undefined input gracefully', () => {
    expect(handlePrismaError(null).status).toBe(500);
    expect(handlePrismaError(undefined).status).toBe(500);
  });

  it('handles non-object input gracefully', () => {
    expect(handlePrismaError('string error').status).toBe(500);
    expect(handlePrismaError(42).status).toBe(500);
  });
});
