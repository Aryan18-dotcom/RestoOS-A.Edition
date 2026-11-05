import Shell from "../../components/Shell";
import RestaurantOperations from "../../components/RestaurantOperations";

export default function Billing() {
  return <Shell title="Billing counter"><RestaurantOperations mode="billing"/></Shell>;
}
