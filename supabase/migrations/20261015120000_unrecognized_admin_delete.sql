-- The admin can delete logged "not understood" messages once the engine understands them
-- (Admin page → "remove the ones that work now"). Students still can't read or delete them.

grant delete on public.unrecognized_inputs to authenticated;

create policy "Admin deletes unrecognized inputs"
  on public.unrecognized_inputs for delete
  to authenticated
  using ((select public.is_admin()));
