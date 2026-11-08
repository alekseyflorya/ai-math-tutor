import type { Skill } from '@tutor/shared';

export interface CurriculumProblem {
  id: string;
  title: string;
  titleUk: string;
  equation: string;
  difficulty: number;
  skills: Skill[];
  featured?: boolean;
}

/**
 * Linear equations, ordered the way Soviet-era textbooks (Kiselyov, Makarychev)
 * build the topic: one operation → several operations → variable on both sides →
 * brackets → negative brackets → fractions → decimals. Each problem adds exactly
 * one new difficulty on top of the previous ones.
 */
export const CURRICULUM: CurriculumProblem[] = [
  {
    id: 'lin-01',
    title: 'One step',
    titleUk: 'Одна дія',
    equation: 'x + 5 = 12',
    difficulty: 1,
    skills: ['isolate_variable'],
  },
  {
    id: 'lin-02',
    title: 'Two steps',
    titleUk: 'Дві дії',
    equation: '3x - 7 = 11',
    difficulty: 1,
    skills: ['isolate_variable', 'arithmetic'],
  },
  {
    id: 'lin-03',
    title: 'Unknown on both sides',
    titleUk: 'Невідоме в обох частинах',
    equation: '5x + 3 = 2x + 18',
    difficulty: 2,
    skills: ['transfer', 'like_terms'],
  },
  {
    id: 'lin-04',
    title: 'Opening brackets',
    titleUk: 'Розкриття дужок',
    equation: '3(x + 4) = 2x + 19',
    difficulty: 2,
    skills: ['distribution', 'transfer'],
    featured: true,
  },
  {
    id: 'lin-05',
    title: 'Brackets on both sides',
    titleUk: 'Дужки з обох боків',
    equation: '4(x - 2) = 2(x + 3)',
    difficulty: 3,
    skills: ['distribution', 'transfer', 'like_terms'],
  },
  {
    id: 'lin-06',
    title: 'Minus before a bracket',
    titleUk: 'Мінус перед дужкою',
    equation: '7 - 2(x - 1) = 3x - 6',
    difficulty: 3,
    skills: ['distribution', 'transfer'],
  },
  {
    id: 'lin-07',
    title: 'Fractional coefficients',
    titleUk: 'Дробові коефіцієнти',
    equation: 'x/2 + 3 = x/3 + 5',
    difficulty: 4,
    skills: ['like_terms', 'isolate_variable'],
  },
  {
    id: 'lin-08',
    title: 'Decimals',
    titleUk: 'Десяткові дроби',
    equation: '0.3(x - 2) + 0.2 = 0.5x - 1.4',
    difficulty: 4,
    skills: ['distribution', 'arithmetic'],
  },
  {
    id: 'lin-09',
    title: 'Olympiad warm-up',
    titleUk: 'Олімпіадна розминка',
    equation: '5(2x - 3) - 2(x + 1) = 3(x + 4) + 1',
    difficulty: 5,
    skills: ['distribution', 'like_terms', 'transfer'],
  },
];
