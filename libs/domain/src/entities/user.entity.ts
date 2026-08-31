import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { UserRole } from '../types/enums';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 190, unique: true }) email: string;
  @Column({ type: 'varchar', length: 80 }) name: string;
  @Column({ name: 'password_hash', type: 'text', nullable: true }) passwordHash: string | null;
  @Column({ type: 'varchar', length: 20, default: 'VIEWER' }) role: UserRole;
  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' }) status: 'ACTIVE' | 'SUSPENDED';
  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true }) lastLoginAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
