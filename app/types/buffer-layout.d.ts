/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "buffer-layout" {
  export function struct(fields: any[], property?: string): any;
  export function u8(property?: string): any;
  export function u32(property?: string): any;
  export function blob(length: number, property?: string): any;
  export function seq(layout: any, count: number, property?: string): any;

  const Layout: any;
  export default Layout;
}
