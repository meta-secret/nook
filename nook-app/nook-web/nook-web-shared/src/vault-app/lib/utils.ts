import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

type TailwindClassCollection = ClassValue[];

export function cn(...inputs: TailwindClassCollection) {
  return twMerge(clsx(inputs));
}

export type WithoutChild<T> = "child" extends keyof T ? Omit<T, "child"> : T;
export type WithoutChildren<T> = "children" extends keyof T
  ? Omit<T, "children">
  : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U;
};
