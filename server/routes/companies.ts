import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { sendError } from '../http/context';

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
    const { code, name, contact_person, phone, email, address } = req.body;
    const newCompany = await prisma.company.create({
      data: {
        code: code.toUpperCase().trim(),
        name: name.trim(),
        contactPerson: contact_person || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
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
    const idNum = Number(req.params.id);
    const { code, name, contact_person, phone, email, address, status } = req.body;
    await prisma.company.update({
      where: { id: idNum },
      data: {
        code: code.toUpperCase().trim(),
        name: name.trim(),
        contactPerson: contact_person,
        phone: phone,
        email: email,
        address: address,
        status: status || 'active'
      }
    });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.delete('/api/companies/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    await prisma.company.delete({ where: { id: idNum } });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
