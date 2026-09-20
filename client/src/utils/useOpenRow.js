import { useNavigate } from 'react-router-dom';

/**
 * Makes a whole table row the thing you click.
 *
 * A row that shows a bill, a school or a block should open it from anywhere
 * along its width, not from the one linked word in it. Keyboard users get the
 * same target — hence the role, the tab stop and the Enter/Space handler,
 * which a bare onClick would leave out.
 *
 *   const openRow = useOpenRow();
 *   <tr {...openRow(`/claims/${c._id}`, `Open ${c.claimId}`)}>
 */
export default function useOpenRow() {
  const navigate = useNavigate();

  return (to, label) => {
    const go = () => navigate(to);
    return {
      className: 'row-open',
      onClick: go,
      role: 'button',
      tabIndex: 0,
      title: label,
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      },
    };
  };
}
