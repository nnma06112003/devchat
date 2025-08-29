import {
  DeepPartial,
  EntityTarget,
  FindOneOptions,
  FindOptionsWhere,
  In,
  Like,
  Repository,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { NotFoundException } from '@nestjs/common';

export abstract class BaseService<T extends { id: any }> {
  protected constructor(protected readonly repository: Repository<T>) {}

  async create(data: DeepPartial<T> | DeepPartial<T>[]): Promise<T | T[]> {
    return await this.repository.save(data as DeepPartial<T>);
  }

  async getById(options: FindOneOptions<T>): Promise<T> {
    const entity = await this.repository.findOne(options);
    if (!entity) throw new NotFoundException('Entity not found');
    return entity;
  }

  async getAll(
    search?: string,
    limit?: number,
    page?: number,
    isDeleted = false,
  ): Promise<{ items: T[]; total: number; limit?: number; page?: number }> {
    const where: FindOptionsWhere<T> = {} as any;

    if ('active' in this.repository.metadata.propertiesMap) {
      Object.assign(where, { active: isDeleted });
    }

    if (search && 'name' in this.repository.metadata.propertiesMap) {
      Object.assign(where, { name: Like(`%${search}%`) });
    }

    const options: any = { where };
    if (limit && page) {
      options.take = limit;
      options.skip = (page - 1) * limit;
    }

    const [items, total] = await this.repository.findAndCount(options);

    return { items, total, ...(limit && { limit }), ...(page && { page }) };
  }

  async update(
    id: number,
    options: FindOneOptions<T>,
    entity: DeepPartial<T>,
  ): Promise<T> {
    await this.getById(options);
    await this.repository.update(id, entity as QueryDeepPartialEntity<T>);
    return this.getById(options);
  }

  async delete(ids: number | number[], isSoft = false): Promise<void> {
    const idArray = Array.isArray(ids) ? ids : [ids];
    const entities = await this.repository.find({ where: { id: In(idArray) } as any });

    if (entities.length !== idArray.length) {
      throw new NotFoundException('One or more entities not found');
    }

    if (isSoft && 'active' in this.repository.metadata.propertiesMap) {
      await this.repository.update(idArray, { active: false } as any);
    } else {
      await this.repository.delete(idArray);
    }
  }

  async check_exist_no_data<U>(
    entity: EntityTarget<U>,
    where: FindOptionsWhere<U>,
    errorMessage: string,
  ): Promise<void> {
    const existing = await this.repository.manager.findOne((entity: EntityTarget<U>) => entity, { where });
    if (existing) throw new Error(errorMessage);
  }

  async check_non_exist_no_data<U>(
    entity: EntityTarget<U>,
    where: FindOptionsWhere<U>,
    errorMessage: string,
  ): Promise<void> {
    const existing = await this.repository.manager.findOne((entity: EntityTarget<U>) => entity, { where });
    if (!existing) throw new Error(errorMessage);
  }

  async check_exist_with_data<U>(
    entity: EntityTarget<U>,
    where: FindOptionsWhere<U>,
    errorMessage?: string,
  ): Promise<U> {
    const existing = await this.repository.manager.findOne((entity: EntityTarget<U>) => entity, { where });
    if (!existing && errorMessage) throw new Error(errorMessage);
    return existing as U;
  }

  async check_exist_with_datas<U>(
    entity: EntityTarget<U>,
    where: FindOptionsWhere<U>,
    length: number,
    errorMessage?: string,
  ): Promise<U[]> {
    const existing = await this.repository.manager.find((entity: EntityTarget<U>) => entity, { where });
    if ((!existing || existing.length !== length) && errorMessage) {
      throw new Error(errorMessage);
    }
    return existing as U[];
  }

  remove_password_field(item: any) {
    if (item?.password) delete item.password;
    return item;
  }
}
