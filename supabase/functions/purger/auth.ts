/**
 * La suppression d'un utilisateur dans Supabase Auth, pour la purge d'une entreprise (`index.ts`).
 */
import { isAuthApiError } from '@supabase/supabase-js';
import { admin } from '../_shared/db.ts';

/** Ce que la suppression emploie du client d'administration (les tests en passent un simulé). */
export interface ClientAuth {
  auth: { admin: Pick<ReturnType<typeof admin>['auth']['admin'], 'deleteUser'> };
}

/**
 * Supprime l'utilisateur, définitivement (sans corbeille : ses identités, ses sessions et son
 * appartenance à l'entreprise partent avec lui). Un utilisateur introuvable est déjà supprimé, par une
 * passe précédente ou une passe simultanée : ce n'est pas une erreur, la purge se rejoue. Toute autre
 * erreur est levée.
 */
export async function supprimerUtilisateur(
  id: string,
  client: ClientAuth = admin(),
): Promise<void> {
  const { error } = await client.auth.admin.deleteUser(id);
  if (
    error &&
    !(isAuthApiError(error) && (error.status === 404 || error.code === 'user_not_found'))
  ) {
    throw error;
  }
}
