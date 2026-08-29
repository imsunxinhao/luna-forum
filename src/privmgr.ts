import { getDB } from './db.js'
import { ObjectId } from 'mongodb'

class PrivManager {
    private get db() {
        return getDB()
    }

    private privMap: Map<string, string[]> = new Map()

    registerPriv(permId: string, defaultRoles: string[] = []): void {
        this.privMap.set(permId, defaultRoles)
    }

    getPrivs(): Map<string, string[]> {
        return this.privMap
    }

    async hasRole(userId: number, roleName: string): Promise<boolean> {
        const user = await this.db.collection('users').findOne({ uid: userId })
        if (!user) return false
        const role = await this.db.collection('roles').findOne({ name: roleName })
        if (!role) return false
        const roleIds = user.roles ?? []
        return roleIds.some((id: string) => id === role._id.toString())
    }

    async hasPriv(userId: number, permId: string): Promise<boolean> {
        const user = await this.db.collection('users').findOne({ uid: userId })
        if (!user) return false
        if (user.banned) return false
        const roleIds = user.roles ?? []
        if (roleIds.length === 0) return false
        const roles = await this.db.collection('roles').find({
            _id: { $in: roleIds.map((id: string) => new ObjectId(id)) }
        }).toArray()
        for (const role of roles) {
            if (role.name === 'superuser') return true
            if (role.perms && role.perms[permId] === true) return true
        }
        return false
    }

    async createRole(name: string, nickname: string): Promise<string> {
        const existing = await this.db.collection('roles').findOne({ name })
        if (existing) throw new Error(`Role ${name} already exists`)
        const result = await this.db.collection('roles').insertOne({
            name,
            nickname,
            perms: {}
        })
        return result.insertedId.toString()
    }

    async deleteRole(roleId: string): Promise<void> {
        await this.db.collection('roles').deleteOne({ _id: new ObjectId(roleId) })
        await this.db.collection('users').updateMany(
            { roles: roleId },
            { $pull: { roles: roleId } as never }
        )
    }

    async setPerm(roleId: string, permId: string, value: boolean): Promise<void> {
        await this.db.collection('roles').updateOne(
            { _id: new ObjectId(roleId) },
            { $set: { [`perms.${permId}`]: value } }
        )
    }

    async setUserRole(userId: number, roleId: string): Promise<void> {
        await this.db.collection('users').updateOne(
            { uid: userId },
            { $addToSet: { roles: roleId } as never }
        )
    }

    async removeUserRole(userId: number, roleId: string): Promise<void> {
        await this.db.collection('users').updateOne(
            { uid: userId },
            { $pull: { roles: roleId } as never }
        )
    }

    async applyDefaultPerms(): Promise<void> {
        for (const [permId, roles] of this.privMap) {
            for (const roleName of roles) {
                const role = await this.db.collection('roles').findOne({ name: roleName })
                if (role) {
                    await this.db.collection('roles').updateOne(
                        { _id: role._id },
                        { $set: { [`perms.${permId}`]: true } }
                    )
                }
            }
        }
    }

    async initDefaultRoles(): Promise<void> {
        const guestRole = await this.db.collection('roles').findOne({ name: 'guest' })
        if (!guestRole) {
            await this.db.collection('roles').insertOne({
                name: 'guest',
                nickname: '游客',
                perms: {}
            })
        }
        const defaultRole = await this.db.collection('roles').findOne({ name: 'default' })
        if (!defaultRole) {
            await this.db.collection('roles').insertOne({
                name: 'default',
                nickname: '默认',
                perms: {}
            })
        }
        const superuserRole = await this.db.collection('roles').findOne({ name: 'superuser' })
        if (!superuserRole) {
            await this.db.collection('roles').insertOne({
                name: 'superuser',
                nickname: '超级管理员',
                perms: {}
            })
        }
    }

    async initGuestUser(): Promise<void> {
        const guest = await this.db.collection('users').findOne({ uid: 0 })
        if (!guest) {
            await this.db.collection('users').insertOne({
                uid: 0,
                username: 'guest',
                roles: [],
                banned: false,
                createdAt: new Date()
            })
        }
    }
    async banUser(userId: number): Promise<void> {
        if (userId === 0) throw new Error('Cannot ban guest user')
        await this.db.collection('users').updateOne(
            { uid: userId },
            { $set: { banned: true, bannedAt: new Date() } }
        )
    }

    async unbanUser(userId: number): Promise<void> {
        await this.db.collection('users').updateOne(
            { uid: userId },
            { $set: { banned: false, unbannedAt: new Date() }, $unset: { bannedAt: '' } }
        )
    }
}

export const privManager = new PrivManager()