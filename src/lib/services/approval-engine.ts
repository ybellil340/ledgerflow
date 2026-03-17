/**
 * LedgerFlow Approval Workflow Engine
 *
 * Configurable multi-step approval system for:
 * - Expenses
 * - Reimbursements
 * - Supplier invoices
 * - Spend requests
 * - Card requests
 */

import type { ApprovalContext, ApprovalRequirement } from '@/lib/auth/rbac'
import { evaluateApprovalRequirement } from '@/lib/auth/rbac'

type EntityType = 'expense' | 'reimbursement' | 'supplier_invoice' | 'spend_request' | 'card_request'

interface InitiateParams {
  entityType: EntityType
  entityId: string
  organizationId: string
  amount: number
  departmentId?: string
  costCenterId?: string
  userId: string
}

interface StepDecisionParams {
  entityType: EntityType
  entityId: string
  organizationId: string
  actorId: string
  decision: 'approve' | 'reject'
  comment?: string
  stepId: string
}

// ─────────────────────────────────────────────
// APPROVAL ENGINE
// ─────────────────────────────────────────────

export class ApprovalEngine {
  private prisma: import('@prisma/client').PrismaClient

  constructor(prismaClient: import('@prisma/client').PrismaClient) {
    this.prisma = prismaClient
  }

  /**
   * Load the applicable approval policy for an entity.
   * Returns the default policy for the entity type, or null if none configured.
   */
  async getPolicy(organizationId: string, entityType: EntityType) {
    return this.prisma.approvalPolicy.findFirst({
      where: { organizationId, entityType, isActive: true, isDefault: true },
      include: { rules: { orderBy: { priority: 'asc' } }, steps: { orderBy: { stepNumber: 'asc' } } },
    })
  }

  /**
   * Evaluate whether an entity requires approval and which steps.
   */
  async evaluate(params: InitiateParams): Promise<ApprovalRequirement> {
    const policy = await this.getPolicy(params.organizationId, params.entityType)

    const context: ApprovalContext = {
      entityType: params.entityType,
      amount: params.amount,
      departmentId: params.departmentId,
      costCenterId: params.costCenterId,
      userId: params.userId,
      organizationId: params.organizationId,
    }

    return evaluateApprovalRequirement(context, policy)
  }

  /**
   * Initiate the approval workflow for an entity.
   * Sets status to PENDING_APPROVAL and logs the first step.
   */
  async initiate(params: InitiateParams): Promise<{ requiresApproval: boolean; stepId?: string }> {
    const requirement = await this.evaluate(params)

    if (!requirement.requiresApproval || requirement.autoApprove) {
      await this.autoApprove(params)
      return { requiresApproval: false }
    }

    // Get or create the policy steps
    const policy = await this.getPolicy(params.organizationId, params.entityType)
    if (!policy) {
      // No policy — auto-approve if under €100, else create a default step
      if (params.amount < 100) {
        await this.autoApprove(params)
        return { requiresApproval: false }
      }
      return { requiresApproval: true }
    }

    const firstStep = policy.steps[0]
    if (!firstStep) return { requiresApproval: false }

    // Notify the approver
    if (firstStep.approverId) {
      await this.prisma.notification.create({
        data: {
          userId: firstStep.approverId,
          organizationId: params.organizationId,
          type: 'approval_required',
          title: `Approval required: ${params.entityType}`,
          message: `A ${params.entityType} of €${params.amount.toFixed(2)} requires your approval`,
          entityType: params.entityType,
          entityId: params.entityId,
        },
      })
    }

    // Update entity status
    await this.updateEntityStatus(params.entityType, params.entityId, 'PENDING_APPROVAL')

    return { requiresApproval: true, stepId: firstStep.id }
  }

  /**
   * Record an approval decision (approve or reject).
   */
  async decide(params: StepDecisionParams): Promise<void> {
    const { entityType, entityId, organizationId, actorId, decision, comment, stepId } = params

    // Record the action
    await this.prisma.approvalAction.create({
      data: {
        stepId,
        actorId,
        entityType,
        entityId,
        status: decision === 'approve' ? 'APPROVED' : 'REJECTED',
        comment,
      },
    })

    if (decision === 'reject') {
      await this.updateEntityStatus(entityType, entityId, 'REJECTED')
      await this.notifySubmitter(entityType, entityId, organizationId, false, comment)
      return
    }

    // Check if there are more steps
    const currentStep = await this.prisma.approvalStep.findUnique({
      where: { id: stepId },
      include: { policy: { include: { steps: { orderBy: { stepNumber: 'asc' } } } } },
    })

    if (!currentStep) return

    const allSteps = currentStep.policy.steps
    const currentIndex = allSteps.findIndex((s) => s.id === stepId)
    const nextStep = allSteps[currentIndex + 1]

    if (nextStep) {
      // Advance to next step
      if (nextStep.approverId) {
        await this.prisma.notification.create({
          data: {
            userId: nextStep.approverId,
            organizationId,
            type: 'approval_required',
            title: `Approval required (step ${nextStep.stepNumber})`,
            message: `A ${entityType} requires your approval at step ${nextStep.stepNumber}`,
            entityType,
            entityId,
          },
        })
      }
    } else {
      // All steps approved — final approval
      await this.updateEntityStatus(entityType, entityId, 'APPROVED')
      await this.notifySubmitter(entityType, entityId, organizationId, true)
    }

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: decision === 'approve' ? 'APPROVE' : 'REJECT',
        entityType,
        entityId,
        metadata: { stepId, comment },
      },
    })
  }

  /**
   * Auto-approve an entity (below threshold or no policy).
   */
  private async autoApprove(params: InitiateParams): Promise<void> {
    await this.updateEntityStatus(params.entityType, params.entityId, 'APPROVED')
    await this.prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        actorId: params.userId,
        action: 'APPROVE',
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: { autoApproved: true, reason: 'Below auto-approve threshold or no policy' },
      },
    })
  }

  /**
   * Update entity approval status in the database.
   */
  private async updateEntityStatus(
    entityType: EntityType,
    entityId: string,
    status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED'
  ): Promise<void> {
    const updateData = {
      approvalStatus: status === 'PENDING_APPROVAL' ? 'PENDING' : status,
      ...(status === 'APPROVED' ? { status: 'APPROVED' } : {}),
      ...(status === 'REJECTED' ? { status: 'REJECTED' } : {}),
    }

    switch (entityType) {
      case 'expense':
        await this.prisma.expense.update({ where: { id: entityId }, data: updateData })
        break
      case 'reimbursement':
        await this.prisma.reimbursement.update({ where: { id: entityId }, data: updateData })
        break
      case 'supplier_invoice':
        await this.prisma.supplierInvoice.update({ where: { id: entityId }, data: updateData })
        break
      case 'spend_request':
        await this.prisma.spendRequest.update({ where: { id: entityId }, data: updateData })
        break
    }
  }

  /**
   * Notify the original submitter of the final decision.
   */
  private async notifySubmitter(
    entityType: EntityType,
    entityId: string,
    organizationId: string,
    approved: boolean,
    comment?: string
  ): Promise<void> {
    // Get submitter ID from entity
    let userId: string | null = null
    let description = entityType

    switch (entityType) {
      case 'expense': {
        const e = await this.prisma.expense.findUnique({ where: { id: entityId }, select: { userId: true, merchant: true } })
        userId = e?.userId ?? null
        description = `expense at ${e?.merchant}`
        break
      }
      case 'reimbursement': {
        const r = await this.prisma.reimbursement.findUnique({ where: { id: entityId }, select: { userId: true, title: true } })
        userId = r?.userId ?? null
        description = `reimbursement "${r?.title}"`
        break
      }
      case 'supplier_invoice': {
        // No submitter to notify for AP invoices (notified the finance team)
        return
      }
      case 'spend_request': {
        const s = await this.prisma.spendRequest.findUnique({ where: { id: entityId }, select: { userId: true, purpose: true } })
        userId = s?.userId ?? null
        description = `spend request "${s?.purpose}"`
        break
      }
    }

    if (!userId) return

    await this.prisma.notification.create({
      data: {
        userId,
        organizationId,
        type: approved ? `${entityType}_approved` : `${entityType}_rejected`,
        title: approved ? 'Approved' : 'Rejected',
        message: approved
          ? `Your ${description} has been approved`
          : `Your ${description} was rejected${comment ? `: ${comment}` : ''}`,
        entityType,
        entityId,
      },
    })
  }

  /**
   * Check for pending approvals that need escalation (cron job).
   */
  async checkEscalations(organizationId: string): Promise<void> {
    const policies = await this.prisma.approvalPolicy.findMany({
      where: { organizationId, isActive: true },
      include: { steps: { where: { escalateDays: { not: null } } } },
    })

    for (const policy of policies) {
      for (const step of policy.steps) {
        if (!step.escalateDays || !step.approverId) continue

        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - step.escalateDays)

        const pendingActions = await this.prisma.approvalAction.findMany({
          where: {
            stepId: step.id,
            status: 'PENDING',
            createdAt: { lt: cutoff },
          },
        })

        for (const action of pendingActions) {
          // Mark as escalated and notify
          await this.prisma.approvalAction.update({
            where: { id: action.id },
            data: { status: 'ESCALATED' },
          })

          // Find the organization admin to notify
          const admins = await this.prisma.organizationMembership.findMany({
            where: { organizationId, role: 'COMPANY_ADMIN', status: 'ACTIVE' },
          })

          for (const admin of admins) {
            await this.prisma.notification.create({
              data: {
                userId: admin.userId,
                organizationId,
                type: 'approval_escalated',
                title: 'Approval escalated',
                message: `An approval has been waiting for ${step.escalateDays} days and has been escalated`,
                entityType: action.entityType,
                entityId: action.entityId,
              },
            })
          }
        }
      }
    }
  }
}

// Singleton factory (use with DI in API routes)
let _engine: ApprovalEngine | null = null

export async function getApprovalEngine(): Promise<ApprovalEngine> {
  if (!_engine) {
    const { default: prisma } = await import('@/lib/db/prisma')
    _engine = new ApprovalEngine(prisma)
  }
  return _engine
}
