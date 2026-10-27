import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { requirePermission, sendError } from '../http/context';
import { companySchema, parseBody } from '../validation/schemas';

// Companies / manufacturers
const router = Router();

router.get('/api/companies', async (_req: Request, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { products: true }
        }
      }
    });

    res.json(companies.map(c => ({
      id: c.id,
      code: c.code,
      name: c.name,
      contact_person: c.contactPerson,
      phone: c.phone,
      email: c.email,
      address: c.address,
      status: c.status,
      created_at: c.createdAt,
      product_count: c._count.products
    })));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/companies', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_add_company', 'You do not have permission to add companies.'))) return;
    const body = parseBody(companySchema, req.body, res);
    if (!body) return;
    const newCompany = await prisma.company.create({
      data: {
        code: body.code.toUpperCase(),
        name: body.name,
        contactPerson: body.contact_person || null,
        phone: body.phone || null,
        email: body.email || null,
        address: body.address || null,
        status: 'active'
      }
    });
    res.json({ success: true, id: newCompany.id });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.put('/api/companies/:id', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_edit_company', 'You do not have permission to edit companies.'))) return;
    const idNum = Number(req.params.id);
    const body = parseBody(companySchema, req.body, res);
    if (!body) return;
    await prisma.company.update({
      where: { id: idNum },
      data: {
        code: body.code.toUpperCase(),
        name: body.name,
        contactPerson: body.contact_person || null,
        phone: body.phone || null,
        email: body.email || null,
        address: body.address || null,
        status: body.status || 'active'
      }
    });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.delete('/api/companies/:id', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_delete_company', 'You do not have permission to delete companies.'))) return;
    const idNum = Number(req.params.id);
    await prisma.company.delete({ where: { id: idNum } });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
